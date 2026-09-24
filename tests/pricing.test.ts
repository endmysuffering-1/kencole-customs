import { describe, expect, it } from "vitest";
import {
  applyRule,
  calculateBrokerCharges,
  selectRule,
  type PricingContext,
  type PricingRuleSnapshot,
} from "@/lib/domain/pricing";

const rule = (r: Partial<PricingRuleSnapshot> & Pick<PricingRuleSnapshot, "id" | "scope">): PricingRuleSnapshot => ({
  chargeCode: "BROKERAGE", label: "Brokerage fee", priority: 100, active: true, ...r,
});
const ctx = (c: Partial<PricingContext> = {}): PricingContext => ({
  customsValue: "1000", lineCount: 1, importType: "COMMERCIAL", ...c,
});

const listPrice = rule({ id: "global", scope: "GLOBAL", percentRate: "0.03" });
const proPlan = rule({ id: "plan-pro", scope: "PLAN", planCode: "PRO", percentRate: "0.02" });
const agreementA = rule({ id: "business-a", scope: "BUSINESS", businessId: "biz-a", percentRate: "0.01" });
const all = [listPrice, proPlan, agreementA];

const pick = (rules: PricingRuleSnapshot[], c: Partial<PricingContext>) => selectRule(rules, "BROKERAGE", ctx(c))?.id;

describe("pricing scope resolution: BUSINESS beats PLAN beats GLOBAL", () => {
  it("uses a business's own agreement over its plan and the list price", () => {
    expect(pick(all, { businessId: "biz-a", planCode: "PRO" })).toBe("business-a");
  });

  it("uses the plan when the business has no agreement of its own", () => {
    expect(pick(all, { businessId: "biz-b", planCode: "PRO" })).toBe("plan-pro");
  });

  it("falls back to the list price when neither applies", () => {
    expect(pick(all, { businessId: "biz-b", planCode: "STARTER" })).toBe("global");
    expect(pick(all, {})).toBe("global");
  });

  it("does not depend on the order the rules arrive in", () => {
    const orders = [all, [...all].reverse(), [proPlan, agreementA, listPrice], [agreementA, listPrice, proPlan]];
    for (const order of orders) expect(pick(order, { businessId: "biz-a", planCode: "PRO" })).toBe("business-a");
  });

  it("ranks by scope before priority", () => {
    const loudPlan = { ...proPlan, priority: 1000 };
    const quietAgreement = { ...agreementA, priority: 1 };
    expect(pick([listPrice, loudPlan, quietAgreement], { businessId: "biz-a", planCode: "PRO" })).toBe("business-a");
  });

  it("uses the higher priority within a scope", () => {
    const special = rule({ id: "plan-pro-special", scope: "PLAN", planCode: "PRO", percentRate: "0.015", priority: 200 });
    expect(pick([...all, special], { businessId: "biz-b", planCode: "PRO" })).toBe("plan-pro-special");
  });

  it("never applies another business's agreement", () => {
    expect(pick(all, { businessId: "biz-b" })).toBe("global");
    expect(pick([agreementA], { businessId: "biz-b" })).toBeUndefined();
    expect(pick([agreementA], { businessId: null })).toBeUndefined();
  });

  it("never applies another plan's rate", () => {
    expect(pick([proPlan], { planCode: "STARTER" })).toBeUndefined();
    expect(pick([proPlan], { planCode: null })).toBeUndefined();
  });

  it("skips an inactive rule and falls to the next scope", () => {
    expect(pick([listPrice, proPlan, { ...agreementA, active: false }], { businessId: "biz-a", planCode: "PRO" })).toBe("plan-pro");
  });

  it("respects import type and value bands", () => {
    const personal = rule({ id: "personal", scope: "GLOBAL", importType: "PERSONAL", percentRate: "0.05" });
    const large = rule({ id: "large", scope: "GLOBAL", minValue: "5000", percentRate: "0.01", priority: 200 });
    expect(pick([listPrice, personal], { importType: "COMMERCIAL" })).toBe("global");
    expect(pick([listPrice, large], { customsValue: "1000" })).toBe("global");
    expect(pick([listPrice, large], { customsValue: "9000" })).toBe("large");
  });
});

describe("fee arithmetic", () => {
  it("combines flat, percentage and per-line parts", () => {
    const r = rule({ id: "r", scope: "GLOBAL", flatAmount: "10", percentRate: "0.01", perLineAmount: "2" });
    expect(applyRule(r, ctx({ customsValue: "1000", lineCount: 3 })).toFixed(2)).toBe("26.00");
  });

  it("holds a fee between its minimum and maximum", () => {
    const r = rule({ id: "r", scope: "GLOBAL", percentRate: "0.02", minFee: "35", maxFee: "500" });
    expect(applyRule(r, ctx({ customsValue: "100" })).toFixed(2)).toBe("35.00");
    expect(applyRule(r, ctx({ customsValue: "100000" })).toFixed(2)).toBe("500.00");
    expect(applyRule(r, ctx({ customsValue: "5000" })).toFixed(2)).toBe("100.00");
  });
});

describe("broker charges", () => {
  const rules = [
    agreementA, listPrice, proPlan,
    rule({ id: "processing", scope: "GLOBAL", chargeCode: "PROCESSING", label: "Processing", flatAmount: "15" }),
    rule({ id: "delivery", scope: "GLOBAL", chargeCode: "DELIVERY", label: "Delivery", flatAmount: "20" }),
    rule({ id: "rush", scope: "GLOBAL", chargeCode: "RUSH", label: "Rush", flatAmount: "60" }),
  ];

  it("only ever produces Kencole charges", () => {
    const lines = calculateBrokerCharges(rules, ctx({ deliveryRequested: true, rush: true }));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.payee === "BROKER")).toBe(true);
  });

  it("resolves each charge on its own: an agreement on brokerage leaves processing at list price", () => {
    const lines = calculateBrokerCharges(rules, ctx({ businessId: "biz-a" }));
    const byCode = Object.fromEntries(lines.map((l) => [l.chargeCode, l]));
    expect(byCode.BROKERAGE?.rateRuleId).toBe("business-a");
    expect(byCode.PROCESSING?.rateRuleId).toBe("processing");
  });

  it("applies a plan discount to brokerage and delivery only", () => {
    const lines = calculateBrokerCharges(rules, ctx({ brokerageDiscount: "0.5", deliveryDiscount: "0.5", deliveryRequested: true }));
    const amount = (code: string) => lines.find((l) => l.chargeCode === code)?.amount;
    expect(amount("BROKERAGE")).toBe("15.00"); // 3% of 1000, halved
    expect(amount("DELIVERY")).toBe("10.00");
    expect(amount("PROCESSING")).toBe("15.00");
  });

  it("charges delivery only when it is asked for, and rush only when rushed", () => {
    const codes = (c: Partial<PricingContext>) => calculateBrokerCharges(rules, ctx(c)).map((l) => l.chargeCode);
    expect(codes({})).not.toContain("DELIVERY");
    expect(codes({})).not.toContain("RUSH");
    expect(codes({ deliveryRequested: true, rush: true })).toEqual(expect.arrayContaining(["DELIVERY", "RUSH"]));
  });
});
