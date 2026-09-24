import { describe, expect, it } from "vitest";
import { formatRate, nassauMidnight, scopeLabel, toInputRate, toStoredRate } from "@/lib/domain/rates";

describe("rate units", () => {
  it("stores a percentage as an exact fraction", () => {
    expect(toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "35")).toBe("0.35");
    expect(toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "7.5")).toBe("0.075");
    expect(toStoredRate("PERCENT_OF_DUTIABLE_TOTAL", "0.0001")).toBe("0.000001");
    expect(toStoredRate("PERCENT_OF_GOODS_VALUE", "12.5%")).toBe("0.125");
    // 0.1 + 0.2 style float drift would show up here.
    expect(toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "14.3")).toBe("0.143");
  });

  it("stores an amount as typed", () => {
    expect(toStoredRate("FLAT", "15.00")).toBe("15");
    expect(toStoredRate("PER_LINE", "2.5")).toBe("2.5");
  });

  it("refuses what it cannot store", () => {
    expect(() => toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "-1")).toThrow(/zero or more/);
    expect(() => toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "abc")).toThrow(/zero or more/);
    expect(() => toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "")).toThrow(/zero or more/);
    expect(() => toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "0.00001")).toThrow(/four decimal places/);
    expect(() => toStoredRate("FLAT", "1000")).toThrow(/too large/);
  });

  it("round-trips and reads back in people's units", () => {
    expect(toInputRate("PERCENT_OF_CUSTOMS_VALUE", toStoredRate("PERCENT_OF_CUSTOMS_VALUE", "7.5"))).toBe("7.5");
    expect(formatRate("PERCENT_OF_CUSTOMS_VALUE", "0.35")).toBe("35%");
    expect(formatRate("PERCENT_OF_DUTIABLE_TOTAL", "0.1")).toBe("10%");
    expect(formatRate("FLAT", "15")).toMatch(/15\.00/);
    expect(formatRate("PER_LINE", "2")).toMatch(/2\.00 per line/);
  });

  it("names a rule's scope", () => {
    expect(scopeLabel({})).toBe("All goods");
    expect(scopeLabel({ chapter: "84" })).toBe("Chapter 84");
    expect(scopeLabel({ hsCode: "2208.40.00", chapter: null })).toBe("Heading 2208.40.00");
  });
});

describe("effective dates in Nassau", () => {
  it("uses standard time in winter and daylight time in summer", () => {
    expect(nassauMidnight("2026-01-15").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(nassauMidnight("2026-07-01").toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });

  it("takes the offset in force at midnight on the days the clocks change", () => {
    // 2026: daylight time starts 8 March, ends 1 November, both at 02:00 local.
    expect(nassauMidnight("2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(nassauMidnight("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("refuses a malformed date", () => {
    expect(() => nassauMidnight("01/07/2026")).toThrow(/YYYY-MM-DD/);
    expect(() => nassauMidnight("2026-02-31")).toThrow(/not a valid date/);
  });
});
