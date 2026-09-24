import { formatMoney } from "@/lib/money";

/** A value as it arrives from the server: a Decimal serialised to a string, or a number. */
export type Amount = string | number | null | undefined;

export const money = (v: Amount) => formatMoney(v ?? 0);

const DATE = new Intl.DateTimeFormat("en-BS", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Nassau" });
const DATETIME = new Intl.DateTimeFormat("en-BS", {
  day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Nassau",
});

export const date = (v: string | Date | null | undefined) => (v ? DATE.format(new Date(v)) : "—");
export const dateTime = (v: string | Date | null | undefined) => (v ? DATETIME.format(new Date(v)) : "—");

export function ago(v: string | Date): string {
  const hours = (Date.now() - new Date(v).getTime()) / 36e5;
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Prisma rows carry Decimal and Date objects, which cannot cross into a client
 *  component. JSON gives exactly what the API would have sent. */
export type Jsonify<T> = T extends Date
  ? string
  : T extends { toFixed(n?: number): string; toNumber(): number }
    ? string
    : T extends (infer U)[]
      ? Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

export const toPlain = <T,>(value: T): Jsonify<T> => JSON.parse(JSON.stringify(value)) as Jsonify<T>;

/** An internal enum value in staff wording: CUSTOMS_HOLD → "Customs hold". Never for customers. */
export const humanise = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ");
