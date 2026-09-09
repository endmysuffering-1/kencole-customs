import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

export function money(value: Decimal.Value | null | undefined): Money {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value as Decimal.Value);
}

/** Round to cents. All persisted and displayed money passes through here. */
export function cents(value: Decimal.Value): Money {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: Decimal.Value[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export function clamp(value: Money, min?: Decimal.Value | null, max?: Decimal.Value | null): Money {
  let out = value;
  if (min !== null && min !== undefined) out = Decimal.max(out, money(min));
  if (max !== null && max !== undefined) out = Decimal.min(out, money(max));
  return out;
}

/**
 * Split a total across weights so the parts always add back to the total.
 * The remainder from rounding lands on the largest weight, not the last one,
 * which keeps the cent off the smallest line where it would be most visible.
 */
export function allocate(total: Decimal.Value, weights: Decimal.Value[]): Money[] {
  const t = cents(total);
  const w = weights.map(money);
  const weightTotal = sum(w);
  if (weightTotal.isZero()) {
    const even = cents(t.dividedBy(Math.max(w.length, 1)));
    const parts = w.map(() => even);
    return settle(parts, t);
  }
  const parts = w.map((x) => cents(t.times(x).dividedBy(weightTotal)));
  return settle(parts, t, w);
}

function settle(parts: Money[], target: Money, weights?: Money[]): Money[] {
  if (parts.length === 0) return parts;
  const diff = target.minus(sum(parts));
  if (diff.isZero()) return parts;
  let idx = 0;
  if (weights) {
    weights.forEach((w, i) => {
      if (w.greaterThan(weights[idx] ?? 0)) idx = i;
    });
  }
  const next = [...parts];
  next[idx] = cents(money(next[idx]).plus(diff));
  return next;
}

const FORMATTER = new Intl.NumberFormat("en-BS", {
  style: "currency",
  currency: "BSD",
  currencyDisplay: "narrowSymbol",
});

export function formatMoney(value: Decimal.Value | null | undefined): string {
  return FORMATTER.format(money(value).toNumber());
}

export function toNumber(value: Decimal.Value | null | undefined): number {
  return money(value).toNumber();
}

export { Decimal };
