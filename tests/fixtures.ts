import type { RateBook } from "@/lib/domain/landed-cost";
import type { PricingRuleSnapshot } from "@/lib/domain/pricing";

/**
 * Test rates are invented, round numbers. They are NOT Bahamian tariff rates and
 * must never be copied into a seed or a migration. The point of these tests is
 * that the arithmetic and the resolution order are right, whatever the rates are.
 */
export function testRateBook(asOf = new Date("2026-06-01")): RateBook {
  return {
    asOf,
    charges: [
      {
        code: "IMPORT_DUTY",
        label: "Import duty",
        payee: "GOVERNMENT",
        basis: "PERCENT_OF_CUSTOMS_VALUE",
        sortOrder: 10,
        baseIncludes: [],
        rules: [
          { id: "duty-default", rate: "0.25", confirmed: true, effectiveFrom: new Date("2020-01-01") },
          { id: "duty-ch84", chapter: "84", rate: "0.10", confirmed: true, effectiveFrom: new Date("2020-01-01") },
          { id: "duty-laptop", hsCode: "8471.30.00", rate: "0", confirmed: true, effectiveFrom: new Date("2020-01-01") },
          { id: "duty-old", hsCode: "8517.13.00", rate: "0.45", confirmed: true, effectiveFrom: new Date("2020-01-01"), effectiveTo: new Date("2025-01-01") },
          { id: "duty-new", hsCode: "8517.13.00", rate: "0.35", confirmed: false, effectiveFrom: new Date("2025-01-01") },
        ],
      },
      {
        code: "ENV_LEVY",
        label: "Environmental levy",
        payee: "GOVERNMENT",
        basis: "PERCENT_OF_CUSTOMS_VALUE",
        sortOrder: 20,
        baseIncludes: [],
        rules: [{ id: "levy-default", rate: "0.01", confirmed: true, effectiveFrom: new Date("2020-01-01") }],
      },
      {
        code: "VAT",
        label: "VAT",
        payee: "GOVERNMENT",
        basis: "PERCENT_OF_DUTIABLE_TOTAL",
        sortOrder: 30,
        baseIncludes: ["IMPORT_DUTY", "ENV_LEVY"],
        rules: [{ id: "vat-default", rate: "0.10", confirmed: true, effectiveFrom: new Date("2020-01-01") }],
      },
    ],
  };
}

export function testPricingRules(): PricingRuleSnapshot[] {
  return [
    {
      id: "brokerage-global", chargeCode: "BROKERAGE", label: "Brokerage fee", scope: "GLOBAL",
      percentRate: "0.02", minFee: "35", maxFee: "500", priority: 100, active: true,
    },
    {
      id: "brokerage-business", chargeCode: "BROKERAGE", label: "Brokerage fee", scope: "BUSINESS",
      businessId: "biz-1", percentRate: "0.01", minFee: "25", priority: 100, active: true,
    },
    {
      id: "brokerage-plan", chargeCode: "BROKERAGE", label: "Brokerage fee", scope: "PLAN",
      planCode: "BUSINESS_PRO", percentRate: "0.015", minFee: "30", priority: 100, active: true,
    },
    {
      id: "processing-global", chargeCode: "PROCESSING", label: "Processing fee", scope: "GLOBAL",
      flatAmount: "15", perLineAmount: "2", priority: 100, active: true,
    },
    {
      id: "delivery-global", chargeCode: "DELIVERY", label: "Delivery", scope: "GLOBAL",
      flatAmount: "20", priority: 100, active: true,
    },
  ];
}
