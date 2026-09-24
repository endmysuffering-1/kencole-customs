import { UnverifiedBadge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { money, type Amount } from "@/lib/format";

export interface BreakdownCharge {
  code: string;
  label: string;
  payee: "GOVERNMENT" | "BROKER";
  amount: Amount;
  unverified: boolean;
}

/**
 * The landed-cost breakdown, wherever it appears.
 *
 * Government money and Kencole money are two separate blocks with their own
 * subtotals and are never mixed in one list. Violet marks money collected for the
 * Public Treasury and teal marks Kencole's fees; neither colour is used for
 * anything else. Any charge from an unconfirmed rate says so, in words.
 */
export function ChargeBreakdown({
  charges,
  goodsValue,
  customsValue,
  governmentTotal,
  brokerTotal,
  grandTotal,
  className,
}: {
  charges: BreakdownCharge[];
  goodsValue?: Amount;
  customsValue: Amount;
  governmentTotal: Amount;
  brokerTotal: Amount;
  grandTotal: Amount;
  className?: string;
}) {
  const government = charges.filter((c) => c.payee === "GOVERNMENT");
  const kencole = charges.filter((c) => c.payee === "BROKER");
  const anyUnverified = government.some((c) => c.unverified);

  return (
    <div className={cn("text-sm", className)}>
      <dl className="space-y-1.5 pb-4">
        {goodsValue != null && <Row label="Goods" amount={goodsValue} />}
        <Row label="Customs value (goods, freight and insurance)" amount={customsValue} strong />
      </dl>

      <Group
        tone="government"
        title="Collected for the Public Treasury"
        note="Duty, levies and VAT. We pay these to Bahamas Customs on your behalf; none of it is our fee."
        charges={government}
        subtotalLabel="Government charges"
        subtotal={governmentTotal}
      />
      <Group
        tone="kencole"
        title="Kencole's fees"
        note="What we charge for handling your import."
        charges={kencole}
        subtotalLabel="Our fees"
        subtotal={brokerTotal}
      />

      <div className="mt-4 flex items-baseline justify-between border-t-2 border-ink pt-3">
        <span className="font-semibold">Total landed cost</span>
        <span className="num text-xl font-bold">{money(grandTotal)}</span>
      </div>

      {anyUnverified && (
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          Rates marked <UnverifiedBadge /> have not yet been confirmed against the current Tariff Act and
          Customs Management Regulations. The final amount is set by Bahamas Customs at assessment.
        </p>
      )}
    </div>
  );
}

function Row({ label, amount, strong }: { label: string; amount: Amount; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn("text-ink-700", strong && "font-medium text-ink")}>{label}</dt>
      <dd className={cn("num", strong && "font-semibold")}>{money(amount)}</dd>
    </div>
  );
}

function Group({
  tone,
  title,
  note,
  charges,
  subtotalLabel,
  subtotal,
}: {
  tone: "government" | "kencole";
  title: string;
  note: string;
  charges: BreakdownCharge[];
  subtotalLabel: string;
  subtotal: Amount;
}) {
  const bar = tone === "government" ? "border-treasury" : "border-teal";
  const text = tone === "government" ? "text-treasury" : "text-teal";
  return (
    <section className={cn("mt-3 border-l-4 pl-4", bar)} aria-label={title}>
      <h3 className={cn("text-xs font-bold uppercase tracking-wider", text)}>{title}</h3>
      <p className="mb-2 text-xs text-ink-500">{note}</p>
      {charges.length === 0 ? (
        <p className="text-ink-500">None</p>
      ) : (
        <dl className="space-y-1.5">
          {charges.map((c) => (
            <div key={c.code} className="flex items-baseline justify-between gap-4">
              <dt className="flex flex-wrap items-center gap-2 text-ink-700">
                {c.label}
                {c.unverified && <UnverifiedBadge />}
              </dt>
              <dd className="num">{money(c.amount)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 flex items-baseline justify-between border-t border-ink/10 pt-2 font-semibold">
        <span>{subtotalLabel}</span>
        <span className={cn("num", text)}>{money(subtotal)}</span>
      </div>
    </section>
  );
}
