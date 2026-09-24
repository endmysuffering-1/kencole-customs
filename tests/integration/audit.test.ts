import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordAudit, requireReason } from "@/lib/audit";
import { resolveRule } from "@/lib/domain/landed-cost";
import { decideClassification } from "@/lib/services/classification-service";
import { supersedeRateRule } from "@/lib/services/rate-service";
import { loadRateBook } from "@/lib/services/rate-book";
import { createShipment, createUser, resetDatabase, seedRates } from "../helpers/db";

beforeEach(resetDatabase);

const auditCount = () => db.auditLog.count();

describe("recordAudit", () => {
  it("marks classification and rate changes as needing a reason", () => {
    expect(requireReason("classification.changed")).toBe(true);
    expect(requireReason("rate.changed")).toBe(true);
    expect(requireReason("classification.approved")).toBe(false);
  });

  it.each(["classification.changed", "rate.changed"] as const)(
    "refuses %s without a reason and writes nothing",
    async (action) => {
      for (const reason of [undefined, "", "   "]) {
        await expect(
          recordAudit({ action, entityType: "Test", entityId: "x", reason }),
        ).rejects.toThrow(/reason is required/);
      }
      expect(await auditCount()).toBe(0);
    },
  );
});

describe("classification changes", () => {
  async function lineAwaitingReview() {
    const { shirts, rum } = await seedRates();
    const broker = await createUser("CUSTOMS_BROKER");
    const owner = await createUser("CONSUMER");
    const shipment = await createShipment({ ownerId: owner.id, lines: [{ lineValue: "100.00", status: "NEEDS_REVIEW" }] });
    const item = await db.shipmentItem.update({
      where: { id: shipment.items[0]!.id },
      data: { suggestedHsCode: shirts.code, confidence: "0.570" },
    });
    return { broker, item, shirts, rum };
  }

  it("refuses a change without a reason and leaves the line as it was", async () => {
    const { broker, item, shirts } = await lineAwaitingReview();

    await expect(
      decideClassification({ itemId: item.id, hsCode: shirts.code, decision: "MODIFY", brokerId: broker.id }),
    ).rejects.toThrow(/Give a reason/);
    await expect(
      decideClassification({ itemId: item.id, hsCode: shirts.code, decision: "EXCEPTION", reason: "  ", brokerId: broker.id }),
    ).rejects.toThrow(/Give a reason/);

    const after = await db.shipmentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.classificationStatus).toBe("NEEDS_REVIEW");
    expect(after.hsCodeId).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it("treats approving a different code from the proposed one as a change", async () => {
    const { broker, item, rum } = await lineAwaitingReview();
    await expect(
      decideClassification({ itemId: item.id, hsCode: rum.code, decision: "APPROVE", brokerId: broker.id }),
    ).rejects.toThrow(/Give a reason/);
    expect(await auditCount()).toBe(0);
  });

  it("records the broker's own reason, never one supplied for them", async () => {
    const { broker, item, rum } = await lineAwaitingReview();
    await decideClassification({
      itemId: item.id, hsCode: rum.code, decision: "MODIFY",
      reason: "Invoice line 3 is cane spirit, not apparel", brokerId: broker.id,
    });

    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: item.id } });
    expect(log.action).toBe("classification.changed");
    expect(log.reason).toBe("Invoice line 3 is cane spirit, not apparel");
    expect(log.actorId).toBe(broker.id);
  });

  it("lets a broker approve the proposed code without a reason", async () => {
    const { broker, item, shirts } = await lineAwaitingReview();
    await decideClassification({ itemId: item.id, hsCode: shirts.code, decision: "APPROVE", brokerId: broker.id });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: item.id } });
    expect(log.action).toBe("classification.approved");
  });

  it("does not keep the change if its audit record cannot be written", async () => {
    const { item, rum } = await lineAwaitingReview();
    // An actor that does not exist fails the audit row's foreign key.
    await expect(
      decideClassification({ itemId: item.id, hsCode: rum.code, decision: "MODIFY", reason: "Checked", brokerId: "no-such-user" }),
    ).rejects.toThrow();

    const after = await db.shipmentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.classificationStatus).toBe("NEEDS_REVIEW");
    expect(after.hsCodeId).toBeNull();
  });
});

describe("rate changes", () => {
  async function dutyRule() {
    await seedRates();
    const broker = await createUser("CUSTOMS_BROKER");
    const rule = await db.rateRule.findFirstOrThrow({
      where: { chargeType: { code: "IMPORT_DUTY" }, hsCodeId: null, chapter: null },
    });
    return { broker, rule };
  }

  it("refuses a change without a reason and changes nothing", async () => {
    const { broker, rule } = await dutyRule();
    const rulesBefore = await db.rateRule.count();

    for (const reason of ["", "   "]) {
      await expect(
        supersedeRateRule({ actorId: broker.id, rateRuleId: rule.id, rate: "0.30", confirmed: false, reason }),
      ).rejects.toThrow(/Say why/);
    }

    expect(await db.rateRule.count()).toBe(rulesBefore);
    const after = await db.rateRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.rate.toString()).toBe(rule.rate.toString());
    expect(after.effectiveTo).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it("closes the old rule and opens a new one instead of editing in place", async () => {
    const { broker, rule } = await dutyRule();
    const from = new Date("2026-07-01T00:00:00Z");

    const next = await supersedeRateRule({
      actorId: broker.id, rateRuleId: rule.id, rate: "0.30", confirmed: false,
      reason: "Budget amendment, pending gazette", effectiveFrom: from,
    });

    const old = await db.rateRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(old.rate.toString()).toBe(rule.rate.toString());
    expect(old.effectiveTo?.toISOString()).toBe(from.toISOString());
    expect(next.effectiveFrom.toISOString()).toBe(from.toISOString());

    // An entry assessed before the change still resolves to the old rate.
    const duty = (asOf: Date) => loadRateBook(asOf).then((b) => b.charges.find((c) => c.code === "IMPORT_DUTY")!);
    expect(resolveRule(await duty(new Date("2026-06-30T12:00:00Z")), null, new Date("2026-06-30T12:00:00Z"))?.id).toBe(rule.id);
    expect(resolveRule(await duty(new Date("2026-07-02T00:00:00Z")), null, new Date("2026-07-02T00:00:00Z"))?.id).toBe(next.id);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "rate.changed" } });
    expect(log.reason).toBe("Budget amendment, pending gazette");
  });

  it("will not mark a rate confirmed without citing the instrument", async () => {
    const { broker, rule } = await dutyRule();
    await expect(
      supersedeRateRule({ actorId: broker.id, rateRuleId: rule.id, rate: "0.25", confirmed: true, reason: "Checked", effectiveFrom: new Date("2026-07-01") }),
    ).rejects.toThrow(/cite the instrument/);
    expect(await auditCount()).toBe(0);
  });

  it("refuses a change from a role that cannot edit rates", async () => {
    const { rule } = await dutyRule();
    const ops = await createUser("OPERATIONS");
    await expect(
      supersedeRateRule({ actorId: ops.id, rateRuleId: rule.id, rate: "0.30", confirmed: false, reason: "Because", effectiveFrom: new Date("2026-07-01") }),
    ).rejects.toThrow(/cannot change rates/);
    expect(await auditCount()).toBe(0);
  });
});
