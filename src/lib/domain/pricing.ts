/**
 * Kencole's own fee engine — brokerage, processing, delivery, storage, rush.
 *
 * Separate from the landed-cost engine on purpose. Government charges are set by
 * law; these are set by the business, and they need to move without a code change
 * or a customs review. Everything here produces payee: "BROKER" lines only.
 */

import { cents, clamp, Decimal, money, sum } from "@/lib/money";
import type { ChargeLine } from "./landed-cost";

export type PricingScope = "GLOBAL" | "PLAN" | "BUSINESS";

export interface PricingRuleSnapshot {
  id: string;
  chargeCode: string;
  label: string;
  scope: PricingScope;
  planCode?: string | null;
  businessId?: string | null;
  importType?: "PERSONAL" | "COMMERCIAL" | null;
  minValue?: string | number | null;
  maxValue?: string | number | null;
  flatAmount?: string | number | null;
  percentRate?: string | number | null;
  perLineAmount?: string | number | null;
  minFee?: string | number | null;
  maxFee?: string | number | null;
  priority: number;
  active: boolean;
}

export interface PricingContext {
  customsValue: string | number;
  lineCount: number;
  importType: "PERSONAL" | "COMMERCIAL";
  businessId?: string | null;
  planCode?: string | null;
  /** Fraction, e.g. 0.15 for a plan that takes 15% off brokerage. */
  brokerageDiscount?: string | number | null;
  deliveryDiscount?: string | number | null;
  rush?: boolean;
  deliveryRequested?: boolean;
}

const DISCOUNTABLE: Record<string, "brokerage" | "delivery" | undefined> = {
  BROKERAGE: "brokerage",
  DELIVERY: "delivery",
};

/**
 * A customer-specific agreement beats a plan rate, which beats the list price.
 * Within a tier, higher priority wins; ties fall to the more recently defined rule.
 */
export function selectRule(
  rules: PricingRuleSnapshot[],
  chargeCode: string,
  ctx: PricingContext,
): PricingRuleSnapshot | null {
  const value = money(ctx.customsValue);
  const eligible = rules.filter((r) => {
    if (!r.active || r.chargeCode !== chargeCode) return false;
    if (r.importType && r.importType !== ctx.importType) return false;
    if (r.minValue != null && value.lessThan(money(r.minValue))) return false;
    if (r.maxValue != null && value.greaterThan(money(r.maxValue))) return false;
    if (r.scope === "BUSINESS" && r.businessId !== ctx.businessId) return false;
    if (r.scope === "PLAN" && r.planCode !== ctx.planCode) return false;
    return true;
  });

  const tierOrder: PricingScope[] = ["BUSINESS", "PLAN", "GLOBAL"];
  for (const tier of tierOrder) {
    const inTier = eligible.filter((r) => r.scope === tier);
    if (inTier.length === 0) continue;
    return [...inTier].sort((a, b) => b.priority - a.priority)[0]!;
  }
  return null;
}

export function applyRule(rule: PricingRuleSnapshot, ctx: PricingContext): Decimal {
  const value = money(ctx.customsValue);
  let amount = new Decimal(0);

  if (rule.flatAmount != null) amount = amount.plus(money(rule.flatAmount));
  if (rule.percentRate != null) amount = amount.plus(value.times(money(rule.percentRate)));
  if (rule.perLineAmount != null) {
    amount = amount.plus(money(rule.perLineAmount).times(Math.max(ctx.lineCount, 1)));
  }

  return clamp(cents(amount), rule.minFee, rule.maxFee);
}

export function calculateBrokerCharges(
  rules: PricingRuleSnapshot[],
  ctx: PricingContext,
): ChargeLine[] {
  const codes = [...new Set(rules.filter((r) => r.active).map((r) => r.chargeCode))];
  const out: ChargeLine[] = [];

  for (const code of codes) {
    if (code === "DELIVERY" && !ctx.deliveryRequested) continue;
    if (code === "RUSH" && !ctx.rush) continue;

    const rule = selectRule(rules, code, ctx);
    if (!rule) continue;

    let amount = applyRule(rule, ctx);

    const discountKind = DISCOUNTABLE[code];
    const discount =
      discountKind === "brokerage"
        ? money(ctx.brokerageDiscount ?? 0)
        : discountKind === "delivery"
          ? money(ctx.deliveryDiscount ?? 0)
          : new Decimal(0);

    if (discount.greaterThan(0)) {
      amount = cents(amount.times(new Decimal(1).minus(discount)));
    }

    if (amount.isZero()) continue;

    out.push({
      chargeCode: code,
      label: rule.label,
      payee: "BROKER",
      basisAmount: money(ctx.customsValue).toFixed(2),
      rateApplied: (rule.percentRate ?? 0).toString(),
      amount: amount.toFixed(2),
      rateRuleId: rule.id,
      unverified: false,
    });
  }

  return out;
}

export function brokerSubtotal(charges: ChargeLine[]): string {
  return cents(sum(charges.filter((c) => c.payee === "BROKER").map((c) => c.amount))).toFixed(2);
}
