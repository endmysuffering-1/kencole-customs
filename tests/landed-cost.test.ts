import { describe, expect, it } from "vitest";
import { calculateLandedCost, resolveRule, summariseCharges } from "@/lib/domain/landed-cost";
import { testRateBook } from "./fixtures";

const book = testRateBook();

describe("rate resolution", () => {
  const duty = book.charges[0]!;

  it("prefers an exact HS code over the chapter rate", () => {
    expect(resolveRule(duty, "8471.30.00", book.asOf)?.id).toBe("duty-laptop");
  });

  it("falls back to the chapter when the code has no rule of its own", () => {
    expect(resolveRule(duty, "8443.31.00", book.asOf)?.id).toBe("duty-ch84");
  });

  it("falls back to the global default when nothing else matches", () => {
    expect(resolveRule(duty, "6109.10.00", book.asOf)?.id).toBe("duty-default");
  });

  it("uses the default when the line is unclassified", () => {
    expect(resolveRule(duty, null, book.asOf)?.id).toBe("duty-default");
  });

  it("ignores a rule that has expired", () => {
    expect(resolveRule(duty, "8517.13.00", book.asOf)?.id).toBe("duty-new");
  });

  it("applies the historic rule when calculating as of an earlier date", () => {
    expect(resolveRule(duty, "8517.13.00", new Date("2024-06-01"))?.id).toBe("duty-old");
  });
});

describe("landed cost", () => {
  it("builds the customs value from goods, freight and insurance", () => {
    const r = calculateLandedCost(
      { goodsValue: "1000", freightCost: "150", insuranceCost: "50", lines: [] },
      book,
    );
    expect(r.customsValue).toBe("1200.00");
  });

  it("charges VAT on the duty-inclusive base, not on the goods alone", () => {
    const r = calculateLandedCost(
      { goodsValue: "1000", freightCost: "0", insuranceCost: "0", lines: [] },
      book,
    );
    const byCode = Object.fromEntries(r.charges.map((c) => [c.chargeCode, c.amount]));
    expect(byCode.IMPORT_DUTY).toBe("250.00"); // 25% of 1000
    expect(byCode.ENV_LEVY).toBe("10.00"); // 1% of 1000
    expect(byCode.VAT).toBe("126.00"); // 10% of (1000 + 250 + 10)
    expect(r.governmentTotal).toBe("386.00");
  });

  it("rates each line on its own tariff rather than blending them", () => {
    // A duty-free laptop and a 25% shirt in one carton must not average out.
    const r = calculateLandedCost(
      {
        goodsValue: "1000",
        freightCost: "0",
        insuranceCost: "0",
        lines: [
          { lineNumber: 1, description: "Laptop", quantity: 1, lineValue: "800", hsCode: "8471.30.00" },
          { lineNumber: 2, description: "T-shirt", quantity: 1, lineValue: "200", hsCode: "6109.10.00" },
        ],
      },
      book,
    );
    const duty = r.charges.filter((c) => c.chargeCode === "IMPORT_DUTY");
    expect(duty.find((c) => c.lineNumber === 1)?.amount).toBe("0.00");
    expect(duty.find((c) => c.lineNumber === 2)?.amount).toBe("50.00");
  });

  it("spreads freight across lines by value so it stays dutiable", () => {
    const r = calculateLandedCost(
      {
        goodsValue: "1000",
        freightCost: "200",
        insuranceCost: "0",
        lines: [
          { lineNumber: 1, description: "A", quantity: 1, lineValue: "750", hsCode: "6109.10.00" },
          { lineNumber: 2, description: "B", quantity: 1, lineValue: "250", hsCode: "6109.10.00" },
        ],
      },
      book,
    );
    const duty = r.charges.filter((c) => c.chargeCode === "IMPORT_DUTY");
    // 1200 CIF split 750:250 -> 900 and 300, at 25%
    expect(duty.find((c) => c.lineNumber === 1)?.amount).toBe("225.00");
    expect(duty.find((c) => c.lineNumber === 2)?.amount).toBe("75.00");
  });

  it("never loses or invents a cent when allocating across lines", () => {
    const r = calculateLandedCost(
      {
        goodsValue: "100",
        freightCost: "0.01",
        insuranceCost: "0",
        lines: [
          { lineNumber: 1, description: "A", quantity: 1, lineValue: "33.33", hsCode: "6109.10.00" },
          { lineNumber: 2, description: "B", quantity: 1, lineValue: "33.33", hsCode: "6109.10.00" },
          { lineNumber: 3, description: "C", quantity: 1, lineValue: "33.34", hsCode: "6109.10.00" },
        ],
      },
      book,
    );
    const bases = r.charges
      .filter((c) => c.chargeCode === "IMPORT_DUTY")
      .reduce((acc, c) => acc + Number(c.basisAmount), 0);
    expect(bases.toFixed(2)).toBe("100.01");
  });

  it("flags a charge whose rate has not been verified against the tariff", () => {
    const r = calculateLandedCost(
      {
        goodsValue: "500", freightCost: "0", insuranceCost: "0",
        lines: [{ lineNumber: 1, description: "Phone", quantity: 1, lineValue: "500", hsCode: "8517.13.00" }],
      },
      book,
    );
    expect(r.unverifiedCharges).toContain("IMPORT_DUTY");
  });

  it("reports unclassified lines so they cannot slip past a broker", () => {
    const r = calculateLandedCost(
      {
        goodsValue: "500", freightCost: "0", insuranceCost: "0",
        lines: [{ lineNumber: 1, description: "Assorted goods", quantity: 1, lineValue: "500" }],
      },
      book,
    );
    expect(r.unclassifiedLines).toEqual([1]);
  });

  it("keeps the grand total equal to value plus every charge", () => {
    const r = calculateLandedCost(
      { goodsValue: "1000", freightCost: "150", insuranceCost: "50", lines: [] },
      book,
      [{ chargeCode: "BROKERAGE", label: "Brokerage", payee: "BROKER", basisAmount: "1200.00", rateApplied: "0.02", amount: "24.00", unverified: false }],
    );
    const expected = 1200 + Number(r.governmentTotal) + Number(r.brokerTotal);
    expect(Number(r.grandTotal)).toBeCloseTo(expected, 2);
    expect(r.brokerTotal).toBe("24.00");
  });
});

describe("charge summary", () => {
  it("collapses per-line charges without changing the total", () => {
    const r = calculateLandedCost(
      {
        goodsValue: "1000", freightCost: "0", insuranceCost: "0",
        lines: [
          { lineNumber: 1, description: "A", quantity: 1, lineValue: "600", hsCode: "6109.10.00" },
          { lineNumber: 2, description: "B", quantity: 1, lineValue: "400", hsCode: "6109.10.00" },
        ],
      },
      book,
    );
    const summary = summariseCharges(r.charges);
    const total = summary.reduce((acc, c) => acc + Number(c.amount), 0);
    expect(total.toFixed(2)).toBe(r.governmentTotal);
    expect(summary.filter((c) => c.chargeCode === "IMPORT_DUTY")).toHaveLength(1);
  });
});
