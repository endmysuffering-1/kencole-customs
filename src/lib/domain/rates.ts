/**
 * How a rate is written down versus how it is stored.
 *
 * A percentage basis stores a fraction (0.35) and people read and type a
 * percentage (35). Every other basis stores an amount in dollars. Converting
 * goes through decimal arithmetic, never floating point, so 7.5% is stored as
 * exactly 0.075.
 */

import { Decimal, formatMoney } from "@/lib/money";

export type ChargeBasis =
  | "PERCENT_OF_CUSTOMS_VALUE" | "PERCENT_OF_DUTIABLE_TOTAL" | "PERCENT_OF_GOODS_VALUE"
  | "FLAT" | "PER_LINE" | "PER_UNIT_WEIGHT";

/** RateRule.rate is Decimal(9, 6): at most 999.999999. */
const MAX_STORED = new Decimal("999.999999");
const STORED_PLACES = 6;

export const isPercentBasis = (basis: ChargeBasis) => basis.startsWith("PERCENT_");

export class RateInputError extends Error {}

/** What the person typed, in the unit the screen shows, to the stored rate. */
export function toStoredRate(basis: ChargeBasis, input: string): string {
  const text = input.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RateInputError("Enter the rate as a number of zero or more.");
  const value = new Decimal(text);
  const stored = isPercentBasis(basis) ? value.dividedBy(100) : value;
  if (stored.decimalPlaces() > STORED_PLACES) {
    throw new RateInputError(
      isPercentBasis(basis) ? "A percentage can have at most four decimal places." : "An amount can have at most six decimal places.",
    );
  }
  if (stored.greaterThan(MAX_STORED)) throw new RateInputError("That rate is too large to store.");
  return stored.toFixed();
}

/** The stored rate in the unit people type it in. */
export function toInputRate(basis: ChargeBasis, stored: string): string {
  const value = new Decimal(stored);
  return (isPercentBasis(basis) ? value.times(100) : value).toFixed();
}

const UNIT: Partial<Record<ChargeBasis, string>> = {
  PER_LINE: " per line",
  PER_UNIT_WEIGHT: " per kg",
};

/** A stored rate as a person reads it: "35%", "$15.00", "$2.00 per line". */
export function formatRate(basis: ChargeBasis, stored: string): string {
  if (isPercentBasis(basis)) return `${toInputRate(basis, stored)}%`;
  return `${formatMoney(stored)}${UNIT[basis] ?? ""}`;
}

export const BASIS_LABEL: Record<ChargeBasis, string> = {
  PERCENT_OF_CUSTOMS_VALUE: "% of customs value (CIF)",
  PERCENT_OF_DUTIABLE_TOTAL: "% of the dutiable total",
  PERCENT_OF_GOODS_VALUE: "% of goods value",
  FLAT: "flat amount",
  PER_LINE: "amount per line",
  PER_UNIT_WEIGHT: "amount per kg",
};

/** Which goods a rule covers, in words. The most specific scope wins. */
export function scopeLabel(rule: { hsCode?: string | null; chapter?: string | null }): string {
  if (rule.hsCode) return `Heading ${rule.hsCode}`;
  if (rule.chapter) return `Chapter ${rule.chapter}`;
  return "All goods";
}

/**
 * Midnight in Nassau on a calendar date, as an instant. Rate changes are
 * gazetted by date, and Nassau keeps daylight time, so the offset is taken on
 * the date itself. 05:00 UTC is before 02:00 local on either offset, so it
 * reads the offset in force at midnight even on the day the clocks change.
 */
export function nassauMidnight(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RateInputError("Enter the date as YYYY-MM-DD.");
  const probe = new Date(`${isoDate}T05:00:00Z`);
  // Date rolls 31 February over into March; a round trip catches it.
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== isoDate) {
    throw new RateInputError("That is not a valid date.");
  }
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Nassau", timeZoneName: "longOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-04:00"
  const offset = name === "GMT" ? "Z" : name.replace("GMT", "");
  return new Date(`${isoDate}T00:00:00${offset}`);
}
