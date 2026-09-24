import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resolveRule } from "@/lib/domain/landed-cost";
import { createRateRule, listRateTable, supersedeRateRule } from "@/lib/services/rate-service";
import { loadRateBook } from "@/lib/services/rate-book";
import { listUsers, recentAccessChanges, setUserActive } from "@/lib/services/user-service";
import { createUser, principalOf, resetDatabase, seedRates } from "../helpers/db";

beforeEach(resetDatabase);

const FROM = new Date("2026-07-01T04:00:00Z");

async function setup() {
  const { shirts, rum } = await seedRates();
  const broker = await createUser("CUSTOMS_BROKER");
  const duty = await db.chargeType.findUniqueOrThrow({ where: { code: "IMPORT_DUTY" } });
  return { broker, duty, shirts, rum };
}

const add = (over: Partial<Parameters<typeof createRateRule>[0]> & { actorId: string; chargeTypeId: string }) =>
  createRateRule({ rate: "0.20", confirmed: false, reason: "Tariff schedule review", effectiveFrom: FROM, ...over });

describe("adding a rate for goods no rule covers yet", () => {
  it("adds a heading rate that then outranks the general rate, and audits it", async () => {
    const { broker, duty, shirts } = await setup();
    const rule = await add({ actorId: broker.id, chargeTypeId: duty.id, hsCode: shirts.code, sourceNote: "Pending check" });

    const book = await loadRateBook(new Date("2026-07-02T00:00:00Z"));
    const resolved = resolveRule(book.charges.find((c) => c.code === "IMPORT_DUTY")!, shirts.code, new Date("2026-07-02T00:00:00Z"));
    expect(resolved?.id).toBe(rule.id);
    // Before it takes effect, the general rate still applies.
    const before = await loadRateBook(new Date("2026-06-30T00:00:00Z"));
    expect(resolveRule(before.charges.find((c) => c.code === "IMPORT_DUTY")!, shirts.code, new Date("2026-06-30T00:00:00Z"))?.id).not.toBe(rule.id);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "rate.created" } });
    expect(log.actorId).toBe(broker.id);
    expect(log.reason).toBe("Tariff schedule review");
    expect(log.newValue).toMatchObject({ hsCode: shirts.code, rate: "0.2", confirmed: false });
  });

  it("adds a chapter rate", async () => {
    const { broker, duty } = await setup();
    const rule = await add({ actorId: broker.id, chargeTypeId: duty.id, chapter: "84" });
    expect(rule.chapter).toBe("84");
    expect(rule.hsCodeId).toBeNull();
  });

  it("will not open a second rule over the same goods", async () => {
    const { broker, duty, rum } = await setup();
    // seedRates already has a rum rule and a general rule.
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id, hsCode: rum.code })).rejects.toMatchObject({ status: 409 });
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id })).rejects.toMatchObject({ status: 409 });
    await add({ actorId: broker.id, chargeTypeId: duty.id, chapter: "84" });
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id, chapter: "84" })).rejects.toMatchObject({ status: 409 });
    expect(await db.auditLog.count({ where: { action: "rate.created" } })).toBe(1);
  });

  it("allows the same goods again once the earlier rule has ended", async () => {
    const { broker, duty, rum } = await setup();
    const old = await db.rateRule.findFirstOrThrow({ where: { chargeTypeId: duty.id, hsCode: { code: rum.code } } });
    await db.rateRule.update({ where: { id: old.id }, data: { effectiveTo: FROM } });
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id, hsCode: rum.code })).resolves.toBeTruthy();
  });

  it("refuses without a reason, and a confirmed rate without its source, writing nothing", async () => {
    const { broker, duty } = await setup();
    const before = await db.rateRule.count();
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id, chapter: "84", reason: "  " })).rejects.toThrow(/Say why/);
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id, chapter: "84", confirmed: true })).rejects.toThrow(/cite the instrument/);
    expect(await db.rateRule.count()).toBe(before);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("refuses unknown headings, malformed chapters, both at once, and bad figures", async () => {
    const { broker, duty, shirts } = await setup();
    const a = { actorId: broker.id, chargeTypeId: duty.id };
    await expect(add({ ...a, hsCode: "9999.99.99" })).rejects.toThrow(/not in the classification table/);
    await expect(add({ ...a, chapter: "8" })).rejects.toThrow(/two digits/);
    await expect(add({ ...a, chapter: "61", hsCode: shirts.code })).rejects.toThrow(/not both/);
    await expect(add({ ...a, chapter: "84", rate: "1000" })).rejects.toThrow(/too large/);
    await expect(add({ ...a, chapter: "84", minAmount: "50", maxAmount: "10" })).rejects.toThrow(/minimum cannot be more/);
    await expect(add({ ...a, chapter: "84", minAmount: "1.005" })).rejects.toThrow(/dollars and cents/);
  });

  it("keeps Kencole's fees out of the rate table", async () => {
    const { broker } = await setup();
    const brokerage = await db.chargeType.findUniqueOrThrow({ where: { code: "BROKERAGE" } });
    await expect(add({ actorId: broker.id, chargeTypeId: brokerage.id })).rejects.toThrow(/pricing rules/);
  });

  it("refuses anyone without rates:edit, including operations and super administrators' juniors", async () => {
    const { duty } = await setup();
    for (const role of ["OPERATIONS", "CONSUMER", "BUSINESS_ADMIN"] as const) {
      const u = await createUser(role);
      await expect(add({ actorId: u.id, chargeTypeId: duty.id, chapter: "84" })).rejects.toMatchObject({ status: 403 });
    }
    const admin = await createUser("SUPER_ADMIN");
    await expect(add({ actorId: admin.id, chargeTypeId: duty.id, chapter: "84" })).resolves.toBeTruthy();
  });

  it("refuses a deactivated editor", async () => {
    const { broker, duty } = await setup();
    await db.user.update({ where: { id: broker.id }, data: { active: false } });
    await expect(add({ actorId: broker.id, chargeTypeId: duty.id, chapter: "84" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("changing a rate checks its figures first", () => {
  it("rejects an out-of-range rate or an inverted minimum and maximum before writing", async () => {
    const { broker, duty } = await setup();
    const rule = await db.rateRule.findFirstOrThrow({ where: { chargeTypeId: duty.id, hsCodeId: null, chapter: null } });
    const base = { actorId: broker.id, rateRuleId: rule.id, confirmed: false, reason: "Review", effectiveFrom: FROM };
    await expect(supersedeRateRule({ ...base, rate: "1000" })).rejects.toThrow(/too large/);
    await expect(supersedeRateRule({ ...base, rate: "0.1", minAmount: "20", maxAmount: "5" })).rejects.toThrow(/minimum cannot be more/);
    expect((await db.rateRule.findUniqueOrThrow({ where: { id: rule.id } })).effectiveTo).toBeNull();
  });
});

describe("the rate table", () => {
  it("shows government charges only, split into in force, scheduled and superseded", async () => {
    const { broker, duty } = await setup();
    const general = await db.rateRule.findFirstOrThrow({ where: { chargeTypeId: duty.id, hsCodeId: null, chapter: null } });
    const now = new Date("2026-06-15T00:00:00Z");
    await supersedeRateRule({ actorId: broker.id, rateRuleId: general.id, rate: "0.3", confirmed: false, reason: "Budget", effectiveFrom: FROM });

    const table = await listRateTable(await principalOf(broker.id), now);
    expect(table.charges.map((c) => c.code)).toEqual(["IMPORT_DUTY", "VAT"]);
    const dutyRow = table.charges[0]!;
    expect(dutyRow.current.map((r) => r.rate)).toEqual(["0.25", "0.5"]); // general first, then the heading
    expect(dutyRow.scheduled.map((r) => r.rate)).toEqual(["0.3"]);
    expect(table.recent[0]).toMatchObject({ action: "rate.changed", reason: "Budget" });

    const later = await listRateTable(await principalOf(broker.id), new Date("2026-08-01T00:00:00Z"));
    expect(later.charges[0]!.past.map((r) => r.id)).toEqual([general.id]);
  });

  it("is not there for customers", async () => {
    await setup();
    const consumer = await createUser("CONSUMER");
    await expect(listRateTable(await principalOf(consumer.id))).rejects.toMatchObject({ status: 404 });
  });
});

describe("switching accounts off and on", () => {
  async function people() {
    const admin = await createUser("SUPER_ADMIN");
    const admin2 = await createUser("SUPER_ADMIN");
    const ops = await createUser("OPERATIONS");
    await db.session.create({ data: { userId: ops.id, tokenHash: "h1", expiresAt: new Date(Date.now() + 864e5) } });
    return { admin, admin2, ops };
  }

  it("deactivates, ends every session, and audits it with the reason", async () => {
    const { admin, ops } = await people();
    await setUserActive({ actorId: admin.id, userId: ops.id, active: false, reason: "Left the company" });
    expect((await db.user.findUniqueOrThrow({ where: { id: ops.id } })).active).toBe(false);
    expect(await db.session.count({ where: { userId: ops.id } })).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "user.deactivated" } });
    expect(log).toMatchObject({ actorId: admin.id, entityId: ops.id, reason: "Left the company" });

    await setUserActive({ actorId: admin.id, userId: ops.id, active: true, reason: "Rehired" });
    expect((await db.user.findUniqueOrThrow({ where: { id: ops.id } })).active).toBe(true);
    const changes = await recentAccessChanges(admin);
    expect(changes.map((c) => c.action)).toEqual(["user.reactivated", "user.deactivated"]);
    expect(changes[0]).toMatchObject({ subject: ops.fullName, reason: "Rehired" });
  });

  it("refuses without a reason, on yourself, and from anyone without users:manage", async () => {
    const { admin, ops } = await people();
    const broker = await createUser("CUSTOMS_BROKER");
    await expect(setUserActive({ actorId: admin.id, userId: ops.id, active: false, reason: " " })).rejects.toThrow(/Give a reason/);
    await expect(setUserActive({ actorId: admin.id, userId: admin.id, active: false, reason: "Test" })).rejects.toMatchObject({ status: 403 });
    await expect(setUserActive({ actorId: broker.id, userId: ops.id, active: false, reason: "Test" })).rejects.toMatchObject({ status: 403 });
    await expect(setUserActive({ actorId: ops.id, userId: broker.id, active: false, reason: "Test" })).rejects.toMatchObject({ status: 403 });
    expect(await db.session.count({ where: { userId: ops.id } })).toBe(1);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("lets one super administrator switch off another, and changes nothing when already in that state", async () => {
    const { admin, admin2 } = await people();
    await setUserActive({ actorId: admin.id, userId: admin2.id, active: false, reason: "Account compromised" });
    await setUserActive({ actorId: admin.id, userId: admin2.id, active: false, reason: "Again" });
    expect(await db.auditLog.count({ where: { action: "user.deactivated" } })).toBe(1);
  });
});

describe("listing accounts", () => {
  it("searches by name or email and filters by role and status, for super administrators only", async () => {
    const admin = await createUser("SUPER_ADMIN");
    const ops = await createUser("OPERATIONS", "ops-person");
    await createUser("CONSUMER", "shopper");
    await db.user.update({ where: { id: ops.id }, data: { active: false } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "user.login", entityType: "User", entityId: admin.id } });

    const all = await listUsers(admin);
    expect(all.users).toHaveLength(3);
    expect(all.users.find((u) => u.id === admin.id)).toMatchObject({ self: true });
    expect(all.users.find((u) => u.id === admin.id)?.lastSignIn).toBeInstanceOf(Date);
    expect(all.roleCounts).toMatchObject({ SUPER_ADMIN: 1, OPERATIONS: 1, CONSUMER: 1 });
    expect((await listUsers(admin, { q: "OPS-PERSON" })).users.map((u) => u.id)).toEqual([ops.id]);
    expect((await listUsers(admin, { role: "CONSUMER" })).users).toHaveLength(1);
    expect((await listUsers(admin, { status: "inactive" })).users.map((u) => u.id)).toEqual([ops.id]);
    // No password hash leaves the service.
    expect(Object.keys(all.users[0]!)).not.toContain("passwordHash");

    const broker = await createUser("CUSTOMS_BROKER");
    await expect(listUsers(broker)).rejects.toMatchObject({ status: 404 });
  });
});
