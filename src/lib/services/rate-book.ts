import { db } from "@/lib/db";
import type { ChargeTypeSnapshot, RateBook } from "@/lib/domain/landed-cost";
import type { PricingRuleSnapshot } from "@/lib/domain/pricing";

/** Loads the configured rates out of the database into the shape the engine wants. */
export async function loadRateBook(asOf = new Date()): Promise<RateBook> {
  const types = await db.chargeType.findMany({
    where: { active: true },
    include: { rateRules: { include: { hsCode: { select: { code: true } } } } },
    orderBy: { sortOrder: "asc" },
  });

  const charges: ChargeTypeSnapshot[] = types.map((t) => ({
    code: t.code,
    label: t.label,
    payee: t.payee,
    basis: t.basis,
    level: t.level,
    sortOrder: t.sortOrder,
    baseIncludes: t.baseIncludes,
    rules: t.rateRules.map((r) => ({
      id: r.id,
      hsCode: r.hsCode?.code ?? null,
      chapter: r.chapter,
      rate: r.rate.toString(),
      minAmount: r.minAmount?.toString() ?? null,
      maxAmount: r.maxAmount?.toString() ?? null,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      confirmed: r.confirmed,
    })),
  }));

  return { charges, asOf };
}

export async function loadPricingRules(businessId?: string | null): Promise<PricingRuleSnapshot[]> {
  const [rules, labels] = await Promise.all([
    db.pricingRule.findMany({
      where: {
        active: true,
        OR: [{ scope: "GLOBAL" }, { scope: "PLAN" }, { scope: "BUSINESS", businessId: businessId ?? "__none__" }],
      },
    }),
    db.chargeType.findMany({ where: { payee: "BROKER" }, select: { code: true, label: true } }),
  ]);

  const labelByCode = new Map(labels.map((l) => [l.code, l.label]));

  return rules.map((r) => ({
    id: r.id,
    chargeCode: r.chargeCode,
    label: labelByCode.get(r.chargeCode) ?? r.chargeCode,
    scope: r.scope,
    planCode: r.planCode,
    businessId: r.businessId,
    importType: r.importType,
    minValue: r.minValue?.toString() ?? null,
    maxValue: r.maxValue?.toString() ?? null,
    flatAmount: r.flatAmount?.toString() ?? null,
    percentRate: r.percentRate?.toString() ?? null,
    perLineAmount: r.perLineAmount?.toString() ?? null,
    minFee: r.minFee?.toString() ?? null,
    maxFee: r.maxFee?.toString() ?? null,
    priority: r.priority,
    active: r.active,
  }));
}
