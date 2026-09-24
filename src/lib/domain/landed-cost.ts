/**
 * Landed cost engine.
 *
 * Two rules govern this file and neither is negotiable:
 *
 *  1. No duty, tax or levy rate is written here. Every rate arrives in the
 *     RateBook, which is loaded from ChargeType + RateRule rows. Changing a
 *     rate is a database operation, never a deployment.
 *
 *  2. Government money and Kencole money are computed into separate buckets and
 *     stay separate all the way to the invoice and the revenue reports. A duty
 *     collected on behalf of the Public Treasury is a liability we are holding,
 *     not income we have earned.
 *
 * The output of this engine is always an estimate. It becomes an assessment only
 * when Bahamas Customs says so.
 */

import { allocate, cents, clamp, Decimal, money, sum, type Money } from "@/lib/money";

export type Payee = "GOVERNMENT" | "BROKER";

export type ChargeBasis =
  | "PERCENT_OF_CUSTOMS_VALUE"
  | "PERCENT_OF_DUTIABLE_TOTAL"
  | "PERCENT_OF_GOODS_VALUE"
  | "FLAT"
  | "PER_LINE"
  | "PER_UNIT_WEIGHT";

export interface RateRuleSnapshot {
  id: string;
  hsCode?: string | null;
  chapter?: string | null;
  rate: string | number;
  minAmount?: string | number | null;
  maxAmount?: string | number | null;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  confirmed: boolean;
}

export type ChargeLevel = "LINE" | "SHIPMENT";

export interface ChargeTypeSnapshot {
  code: string;
  label: string;
  payee: Payee;
  basis: ChargeBasis;
  sortOrder: number;
  /** Charge codes folded into the base for PERCENT_OF_DUTIABLE_TOTAL. */
  baseIncludes: string[];
  /**
   * LINE (the default): computed on every line against that line's own tariff
   * heading — duty and VAT work this way.
   * SHIPMENT: computed once for the whole entry against the general rule, so a
   * minimum or maximum bounds the entry rather than each line. Heading- and
   * chapter-specific rules are not consulted for a shipment-level charge.
   * Which charges are which is configuration, not something this engine decides.
   */
  level?: ChargeLevel;
  rules: RateRuleSnapshot[];
}

/** Everything the engine is allowed to know about rates, loaded from the database. */
export interface RateBook {
  charges: ChargeTypeSnapshot[];
  asOf: Date;
}

export interface LineInput {
  lineNumber: number;
  description: string;
  quantity: number | string;
  lineValue: number | string;
  hsCode?: string | null;
  weightKg?: number | string | null;
}

export interface ShipmentInput {
  goodsValue: number | string;
  freightCost: number | string;
  insuranceCost: number | string;
  grossWeightKg?: number | string | null;
  lines: LineInput[];
}

export interface ChargeLine {
  chargeCode: string;
  label: string;
  payee: Payee;
  lineNumber?: number;
  basisAmount: string;
  rateApplied: string;
  amount: string;
  rateRuleId?: string;
  /** True when the rate has not been checked against the current tariff. */
  unverified: boolean;
}

export interface LandedCostResult {
  customsValue: string;
  goodsValue: string;
  freightCost: string;
  insuranceCost: string;
  charges: ChargeLine[];
  governmentTotal: string;
  brokerTotal: string;
  grandTotal: string;
  /** Charge codes whose rate came from an unconfirmed rule. Surfaced in the UI. */
  unverifiedCharges: string[];
  /** Lines with no HS code, so a default rate was used. Forces broker review. */
  unclassifiedLines: number[];
  calculatedAt: string;
}

function chapterOf(hsCode: string | null | undefined): string | null {
  if (!hsCode) return null;
  const digits = hsCode.replace(/\D/g, "");
  return digits.length >= 2 ? digits.slice(0, 2) : null;
}

/**
 * Most specific rule wins: exact HS code, then chapter, then the global default.
 * Ties break on the most recent effective date so a rate change supersedes cleanly.
 */
export function resolveRule(
  charge: ChargeTypeSnapshot,
  hsCode: string | null | undefined,
  asOf: Date,
): RateRuleSnapshot | null {
  const chapter = chapterOf(hsCode);
  const live = charge.rules.filter((r) => {
    const from = r.effectiveFrom ?? new Date(0);
    const to = r.effectiveTo;
    return from <= asOf && (!to || to > asOf);
  });

  const tiers: RateRuleSnapshot[][] = [
    hsCode ? live.filter((r) => r.hsCode === hsCode) : [],
    chapter ? live.filter((r) => !r.hsCode && r.chapter === chapter) : [],
    live.filter((r) => !r.hsCode && !r.chapter),
  ];

  for (const tier of tiers) {
    if (tier.length === 0) continue;
    return [...tier].sort(
      (a, b) => (b.effectiveFrom?.getTime() ?? 0) - (a.effectiveFrom?.getTime() ?? 0),
    )[0]!;
  }
  return null;
}

/**
 * Compute government charges per line, then broker charges on the shipment.
 * Per-line calculation is what makes mixed shipments correct: a carton holding a
 * laptop and a bottle of rum is two duty rates, not an average.
 */
export function calculateLandedCost(
  shipment: ShipmentInput,
  rateBook: RateBook,
  brokerCharges: ChargeLine[] = [],
): LandedCostResult {
  const goodsValue = cents(shipment.goodsValue);
  const freight = cents(shipment.freightCost);
  const insurance = cents(shipment.insuranceCost);
  const customsValue = cents(goodsValue.plus(freight).plus(insurance));
  const asOf = rateBook.asOf;

  const lines = shipment.lines.length
    ? shipment.lines
    : [
        {
          lineNumber: 1,
          description: "Shipment contents",
          quantity: 1,
          lineValue: goodsValue.toString(),
          hsCode: null,
        } satisfies LineInput,
      ];

  // Freight and insurance are dutiable, so they are spread across the lines in
  // proportion to value before any rate is applied.
  const lineValues = lines.map((l) => money(l.lineValue));
  const lineCustomsValues = allocate(customsValue, lineValues);

  const governmentTypes = rateBook.charges
    .filter((c) => c.payee === "GOVERNMENT")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const charges: ChargeLine[] = [];
  const unverified = new Set<string>();
  const unclassified = lines.filter((l) => !l.hsCode).map((l) => l.lineNumber);
  const lineCifs = lines.map((_, index) => money(lineCustomsValues[index] ?? 0));

  // Every government charge computed so far, as an amount per line, so a charge
  // declaring baseIncludes: ["IMPORT_DUTY"] can build on the duty already worked
  // out. A shipment-level charge is spread back across the lines by customs value
  // so that a later per-line charge can still include it in its base.
  const accumulated = lines.map(() => new Map<string, Money>());
  const included = (type: ChargeTypeSnapshot, index: number) =>
    sum(type.baseIncludes.map((code) => accumulated[index]!.get(code) ?? new Decimal(0)));

  // Charge types in sortOrder, so a charge's base only ever includes charges
  // ordered before it.
  for (const type of governmentTypes) {
    if (type.level === "SHIPMENT") {
      const rule = resolveRule(type, null, asOf);
      if (!rule) continue;

      const rate = money(rule.rate);
      let base: Money;
      switch (type.basis) {
        case "PERCENT_OF_CUSTOMS_VALUE":
          base = customsValue;
          break;
        case "PERCENT_OF_GOODS_VALUE":
          base = goodsValue;
          break;
        case "PERCENT_OF_DUTIABLE_TOTAL":
          base = cents(customsValue.plus(sum(lines.map((_, index) => included(type, index)))));
          break;
        case "PER_UNIT_WEIGHT":
          base = money(shipment.grossWeightKg ?? 0);
          break;
        case "PER_LINE":
          base = new Decimal(lines.length);
          break;
        case "FLAT":
          base = new Decimal(1);
          break;
      }

      const raw = type.basis === "FLAT" ? rate : base.times(rate);
      const amount = clamp(cents(raw), rule.minAmount, rule.maxAmount);

      allocate(amount, lineCifs).forEach((share, index) => accumulated[index]!.set(type.code, share));
      if (!rule.confirmed) unverified.add(type.code);

      charges.push({
        chargeCode: type.code,
        label: type.label,
        payee: "GOVERNMENT",
        basisAmount: base.toFixed(2),
        rateApplied: rate.toString(),
        amount: amount.toFixed(2),
        rateRuleId: rule.id,
        unverified: !rule.confirmed,
      });
      continue;
    }

    lines.forEach((line, index) => {
      const rule = resolveRule(type, line.hsCode, asOf);
      if (!rule) return;

      const lineCif = lineCifs[index]!;
      const rate = money(rule.rate);
      let base: Money;
      switch (type.basis) {
        case "PERCENT_OF_CUSTOMS_VALUE":
          base = lineCif;
          break;
        case "PERCENT_OF_GOODS_VALUE":
          base = money(line.lineValue);
          break;
        case "PERCENT_OF_DUTIABLE_TOTAL":
          base = cents(lineCif.plus(included(type, index)));
          break;
        case "PER_UNIT_WEIGHT":
          base = money(line.weightKg ?? 0);
          break;
        case "PER_LINE":
        case "FLAT":
          base = new Decimal(1);
          break;
      }

      const raw =
        type.basis === "FLAT" || type.basis === "PER_LINE" ? rate : base.times(rate);
      const amount = clamp(cents(raw), rule.minAmount, rule.maxAmount);

      accumulated[index]!.set(type.code, amount);
      if (!rule.confirmed) unverified.add(type.code);

      charges.push({
        chargeCode: type.code,
        label: type.label,
        payee: "GOVERNMENT",
        lineNumber: line.lineNumber,
        basisAmount: base.toFixed(2),
        rateApplied: rate.toString(),
        amount: amount.toFixed(2),
        rateRuleId: rule.id,
        unverified: !rule.confirmed,
      });
    });
  }

  charges.push(...brokerCharges);

  const governmentTotal = cents(
    sum(charges.filter((c) => c.payee === "GOVERNMENT").map((c) => c.amount)),
  );
  const brokerTotal = cents(sum(charges.filter((c) => c.payee === "BROKER").map((c) => c.amount)));

  return {
    customsValue: customsValue.toFixed(2),
    goodsValue: goodsValue.toFixed(2),
    freightCost: freight.toFixed(2),
    insuranceCost: insurance.toFixed(2),
    charges,
    governmentTotal: governmentTotal.toFixed(2),
    brokerTotal: brokerTotal.toFixed(2),
    grandTotal: cents(customsValue.plus(governmentTotal).plus(brokerTotal)).toFixed(2),
    unverifiedCharges: [...unverified],
    unclassifiedLines: unclassified,
    calculatedAt: new Date().toISOString(),
  };
}

/** Collapse per-line charges into one row per charge code for customer display. */
export function summariseCharges(charges: ChargeLine[]): ChargeLine[] {
  const byCode = new Map<string, ChargeLine>();
  for (const c of charges) {
    const existing = byCode.get(c.chargeCode);
    if (!existing) {
      byCode.set(c.chargeCode, { ...c, lineNumber: undefined });
      continue;
    }
    existing.amount = money(existing.amount).plus(money(c.amount)).toFixed(2);
    existing.basisAmount = money(existing.basisAmount).plus(money(c.basisAmount)).toFixed(2);
    existing.unverified = existing.unverified || c.unverified;
  }
  return [...byCode.values()];
}
