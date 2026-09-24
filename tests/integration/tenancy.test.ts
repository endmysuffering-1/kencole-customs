import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canAccessResource } from "@/lib/auth/rbac";
import { loadPricingRules } from "@/lib/services/rate-book";
import { estimateShipment } from "@/lib/services/shipment-service";
import { changeUserRole } from "@/lib/services/user-service";
import { createBusiness, createShipment, createUser, principalOf, resetDatabase, seedRates } from "../helpers/db";

beforeEach(resetDatabase);

describe("cross-tenant access, with principals built from real memberships", () => {
  async function tenants() {
    const [consumerA, consumerB, importerA, importerB] = await Promise.all([
      createUser("CONSUMER", "consumer-a"), createUser("CONSUMER", "consumer-b"),
      createUser("BUSINESS_USER", "importer-a"), createUser("BUSINESS_USER", "importer-b"),
    ]);
    const businessA = await createBusiness([{ userId: importerA.id }]);
    const businessB = await createBusiness([{ userId: importerB.id }]);
    const consumerBShipment = await createShipment({ ownerId: consumerB.id, lines: [{ lineValue: "10.00" }] });
    const businessBShipment = await createShipment({ ownerId: importerB.id, businessId: businessB.id, lines: [{ lineValue: "10.00" }] });
    return { consumerA, consumerB, importerA, importerB, businessA, businessB, consumerBShipment, businessBShipment };
  }

  it("does not let consumer A read consumer B's shipment", async () => {
    const t = await tenants();
    expect(canAccessResource(await principalOf(t.consumerA.id), t.consumerBShipment, "read")).toBe(false);
    expect(canAccessResource(await principalOf(t.consumerB.id), t.consumerBShipment, "read")).toBe(true);
  });

  it("does not let business A read business B's shipment", async () => {
    const t = await tenants();
    expect(canAccessResource(await principalOf(t.importerA.id), t.businessBShipment, "read")).toBe(false);
    expect(canAccessResource(await principalOf(t.importerA.id), t.businessBShipment, "write")).toBe(false);
  });

  it("grants access through membership, and takes it away when membership ends", async () => {
    const t = await tenants();
    const membership = await db.businessMember.create({ data: { businessId: t.businessB.id, userId: t.importerA.id } });
    expect(canAccessResource(await principalOf(t.importerA.id), t.businessBShipment)).toBe(true);

    await db.businessMember.delete({ where: { id: membership.id } });
    expect(canAccessResource(await principalOf(t.importerA.id), t.businessBShipment)).toBe(false);
  });
});

describe("pricing agreements stay with their business", () => {
  it("never loads business A's agreement for business B", async () => {
    const [a, b] = await Promise.all([createUser("BUSINESS_USER"), createUser("BUSINESS_USER")]);
    const businessA = await createBusiness([{ userId: a.id }]);
    const businessB = await createBusiness([{ userId: b.id }]);
    await db.pricingRule.createMany({
      data: [
        { chargeCode: "BROKERAGE", scope: "GLOBAL", percentRate: "0.03" },
        { chargeCode: "BROKERAGE", scope: "BUSINESS", businessId: businessA.id, percentRate: "0.001" },
      ],
    });

    const forB = await loadPricingRules(businessB.id);
    expect(forB.some((r) => r.businessId === businessA.id)).toBe(false);
    expect((await loadPricingRules(null)).some((r) => r.scope === "BUSINESS")).toBe(false);
    expect((await loadPricingRules(businessA.id)).some((r) => r.businessId === businessA.id)).toBe(true);
  });

  it("prices business B's shipment without business A's agreement", async () => {
    const { shirts } = await seedRates();
    const [a, b] = await Promise.all([createUser("BUSINESS_USER"), createUser("BUSINESS_USER")]);
    const businessA = await createBusiness([{ userId: a.id }]);
    const businessB = await createBusiness([{ userId: b.id }]);
    const agreement = await db.pricingRule.create({
      data: { chargeCode: "BROKERAGE", scope: "BUSINESS", businessId: businessA.id, percentRate: "0.001", priority: 1000 },
    });
    const shipment = await createShipment({ ownerId: b.id, businessId: businessB.id, lines: [{ lineValue: "1000.00", hsCodeId: shirts.id }] });

    const estimate = await estimateShipment(shipment.id);
    const brokerage = estimate.charges.find((c) => c.chargeCode === "BROKERAGE");
    expect(brokerage?.rateRuleId).not.toBe(agreement.id);
  });
});

describe("OPERATIONS cannot gain SUPER_ADMIN", () => {
  async function staff() {
    const [admin, ops, ops2] = await Promise.all([
      createUser("SUPER_ADMIN"), createUser("OPERATIONS"), createUser("OPERATIONS"),
    ]);
    return { admin, ops, ops2 };
  }
  const roleOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).role;

  it("cannot promote itself", async () => {
    const { ops } = await staff();
    await expect(changeUserRole({ actorId: ops.id, userId: ops.id, role: "SUPER_ADMIN", reason: "Need access" })).rejects.toThrow();
    expect(await roleOf(ops.id)).toBe("OPERATIONS");
  });

  it("cannot promote a colleague, to SUPER_ADMIN or anything else", async () => {
    const { ops, ops2 } = await staff();
    for (const role of ["SUPER_ADMIN", "CUSTOMS_BROKER"] as const) {
      await expect(changeUserRole({ actorId: ops.id, userId: ops2.id, role, reason: "Cover" })).rejects.toThrow(/cannot change roles/);
    }
    expect(await roleOf(ops2.id)).toBe("OPERATIONS");
    expect(await db.auditLog.count({ where: { action: "user.role_changed" } })).toBe(0);
  });

  it("cannot demote a super administrator", async () => {
    const { admin, ops } = await staff();
    await expect(changeUserRole({ actorId: ops.id, userId: admin.id, role: "CONSUMER", reason: "x" })).rejects.toThrow();
    expect(await roleOf(admin.id)).toBe("SUPER_ADMIN");
  });

  it("lets a super administrator change a role, with a reason, on the record", async () => {
    const { admin, ops2 } = await staff();
    await changeUserRole({ actorId: admin.id, userId: ops2.id, role: "CUSTOMS_BROKER", reason: "Licence confirmed 2026-09" });
    expect(await roleOf(ops2.id)).toBe("CUSTOMS_BROKER");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "user.role_changed" } });
    expect(log.reason).toBe("Licence confirmed 2026-09");
    expect(log.actorId).toBe(admin.id);
  });

  it("refuses a role change without a reason, even from a super administrator", async () => {
    const { admin, ops2 } = await staff();
    await expect(changeUserRole({ actorId: admin.id, userId: ops2.id, role: "CUSTOMS_BROKER", reason: " " })).rejects.toThrow(/reason/);
    expect(await roleOf(ops2.id)).toBe("OPERATIONS");
  });

  it("does not let anyone change their own role", async () => {
    const { admin } = await staff();
    await expect(changeUserRole({ actorId: admin.id, userId: admin.id, role: "OPERATIONS", reason: "Stepping down" })).rejects.toThrow(/own role/);
  });

  it("acts on the role the database holds, not the one a session remembers", async () => {
    const { admin, ops2 } = await staff();
    await db.user.update({ where: { id: admin.id }, data: { active: false } });
    await expect(changeUserRole({ actorId: admin.id, userId: ops2.id, role: "SUPER_ADMIN", reason: "x" })).rejects.toThrow(/cannot change roles/);
  });
});
