import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { customerOverview, listShipments } from "@/lib/services/shipment-queries";
import { CUSTOMER_ACTION_STATUSES } from "@/lib/domain/shipment-state";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { ShipmentStatusBadge } from "@/components/shipment/status-badge";
import { cn } from "@/lib/cn";
import { dateTime, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Home" };

const NEXT_STEP: Record<string, string> = {
  DRAFT: "Upload the seller's invoice",
  DOCUMENTS_REQUIRED: "Send the document we asked for",
  QUOTE_READY: "Review and accept your quote",
  AWAITING_PAYMENT: "Pay the invoice",
};

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Nassau" }).format(now));
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const day = new Intl.DateTimeFormat("en-BS", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Nassau" }).format(now);
  return `${day} · ${part}`;
}

export default async function Home() {
  const user = await pageUser({ next: "/dashboard", capability: "shipment:read:own" });
  const [o, list] = await Promise.all([customerOverview(user), listShipments(user, { take: 50 })]);
  const overview = toPlain(o);
  const shipments = toPlain(list.shipments);
  const needsYou = shipments.filter((s) => (CUSTOMER_ACTION_STATUSES as string[]).includes(s.status));
  const first = user.fullName.split(/\s+/)[0];

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-card bg-gradient-to-br from-ocean via-ocean-600 to-sky p-6 text-white shadow-lift">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,.07)_0%,transparent_70%)]" />
        <div className="relative">
          <p className="text-xs font-medium text-white/55">{greeting(new Date())}</p>
          <h2 className="mt-1 font-serif text-2xl font-bold tracking-tight">Welcome back, {first}</h2>
          <p className="mt-1 text-sm text-white/65">
            {overview.needsYou > 0 ? `${overview.needsYou} ${overview.needsYou === 1 ? "shipment needs" : "shipments need"} you` : "Nothing needs you right now"}
            {overview.released > 0 ? ` · ${overview.released} released` : ""}
          </p>
        </div>
        <LinkButton href="/shipments/new" className="relative px-4 py-2">+ Clear a shipment</LinkButton>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active shipments" value={overview.active} sub={`${overview.total} in total`} accent="bg-sky" />
        <Stat label="Need you" value={overview.needsYou} sub={overview.needsYou ? "See below" : "All caught up"} accent="bg-coral" />
        <Stat label="Released" value={overview.released} sub="Ready to collect or on the way" accent="bg-success" />
        <Stat label="Government charges paid" value={money(overview.governmentPaid)} sub="Duty, VAT and levies" accent="bg-treasury" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-ink-500">Needs you</p>
          {needsYou.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">Nothing to do right now. Anything that needs you will show here.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {needsYou.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <Link href={`/shipments/${s.id}`} className="flex items-center justify-between gap-3 rounded-field border border-line px-4 py-3 transition hover:-translate-y-px hover:border-line-hover hover:shadow-card">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.description ?? s.items[0]?.description ?? "Shipment"}</span>
                      <span className="block text-xs text-coral-600">{NEXT_STEP[s.status]}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-ocean">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-ink-500">Recent activity</p>
          {overview.activity.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">No activity yet.</p>
          ) : (
            <ol className="mt-3">
              {overview.activity.map((a, i) => (
                <li key={a.id} className="relative flex gap-4 pb-4 last:pb-0">
                  {i < overview.activity.length - 1 && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-line" />}
                  <span className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs",
                    i === 0 ? "border-sky/30 bg-sky/15 text-sky" : "border-success/30 bg-success/15 text-success",
                  )}>{i === 0 ? "→" : "✓"}</span>
                  <Link href={`/shipments/${a.shipment.id}`} className="min-w-0 hover:underline">
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-ink-500">{a.shipment.description ?? a.shipment.reference} · {dateTime(a.at)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-ink-500">Recent shipments</p>
          <Link href="/shipments" className="text-sm font-semibold text-sky hover:underline">View all →</Link>
        </div>
        {shipments.length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-serif text-lg font-semibold text-ocean">No shipments yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">Tell us what&apos;s arrived and where it&apos;s waiting. You&apos;ll see the cost before you pay anything.</p>
            <LinkButton href="/shipments/new" className="mt-4">Clear a shipment</LinkButton>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {shipments.slice(0, 5).map((s) => (
              <li key={s.id}>
                <Link href={`/shipments/${s.id}`} className="flex items-center justify-between gap-3 rounded-field border border-line px-4 py-3 transition hover:-translate-y-px hover:border-line-hover hover:shadow-card">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.description ?? s.items[0]?.description ?? "Shipment"}</span>
                    <span className="num block font-mono text-xs text-ink-500">{s.reference}</span>
                  </span>
                  <ShipmentStatusBadge status={s.status} label={s.statusLabel} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-white px-5 py-4 shadow-card">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="num mt-1 font-serif text-[1.7rem] font-bold leading-none tracking-tight text-ocean">{value}</p>
      <p className="mt-1.5 text-[0.7rem] text-ink-500">{sub}</p>
      <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-[3px]", accent)} />
    </div>
  );
}
