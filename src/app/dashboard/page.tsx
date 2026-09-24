import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { listShipments } from "@/lib/services/shipment-queries";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { date, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Your shipments" };

const NEEDS_YOU = ["DRAFT", "DOCUMENTS_REQUIRED", "QUOTE_READY", "AWAITING_PAYMENT"];
const DONE = ["DELIVERED"];
const TABS = [
  { key: "all", label: "All" },
  { key: "needs-you", label: "Needs you" },
  { key: "in-progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const inTab = (tab: Tab, status: string) =>
  tab === "all" ||
  (tab === "needs-you" && NEEDS_YOU.includes(status)) ||
  (tab === "completed" && DONE.includes(status)) ||
  (tab === "cancelled" && status === "CANCELLED") ||
  (tab === "in-progress" && !NEEDS_YOU.includes(status) && !DONE.includes(status) && status !== "CANCELLED");

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const user = await pageUser({ next: "/dashboard", capability: "shipment:read:own" });
  const params = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === params.tab) ? (params.tab as Tab) : "all";
  const q = params.q?.trim().slice(0, 100) || undefined;
  const { shipments: all } = toPlain(await listShipments(user, { q, take: 100 }));
  const shipments = all.filter((s) => inTab(tab, s.status));
  const waiting = all.filter((s) => NEEDS_YOU.includes(s.status)).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <nav className="text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">Home</Link> › <span className="text-ink">Your shipments</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-title font-bold">Your shipments</h1>
        <form className="flex w-full gap-2 sm:w-auto" action="/dashboard">
          {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
          <label htmlFor="shipment-search" className="sr-only">Search your shipments</label>
          <input id="shipment-search" name="q" defaultValue={q} placeholder="Search by reference or item" className={cn(inputClass, "sm:w-72")} />
          <button type="submit" className="shrink-0 rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-700">Search</button>
        </form>
      </div>

      <div className="mt-4 flex gap-6 overflow-x-auto border-b border-ink/15 text-sm" role="tablist">
        {TABS.map((t) => {
          const count = all.filter((s) => inTab(t.key, s.status)).length;
          return (
            <Link
              key={t.key}
              role="tab"
              aria-selected={t.key === tab}
              href={`/dashboard?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-1 pb-2 font-medium",
                t.key === tab ? "border-buy font-bold text-ink" : "border-transparent text-ink-500 hover:text-ink",
              )}
            >
              {t.label}{t.key === "needs-you" && waiting > 0 ? ` (${waiting})` : t.key !== "all" && count > 0 ? ` (${count})` : ""}
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-ink-700">
        <span className="font-bold">{shipments.length} {shipments.length === 1 ? "shipment" : "shipments"}</span>
        {q ? <> matching &ldquo;{q}&rdquo;</> : null}
        {tab === "all" && waiting > 0 && !q ? <>, {waiting} {waiting === 1 ? "needs" : "need"} something from you</> : null}
      </p>

      {all.length === 0 && !q ? (
        <Card className="mt-4 px-6 py-12 text-center">
          <h2 className="text-lg font-bold">No shipments yet</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-500">
            Tell us what&apos;s arrived and where it&apos;s waiting. We&apos;ll estimate the duty, VAT and our fees before you pay anything.
          </p>
          <LinkButton href="/shipments/new" className="mt-6">Clear a shipment</LinkButton>
        </Card>
      ) : (
        <ol className="mt-4 space-y-4">
          {shipments.map((s) => (
            <li key={s.id}>
              <ShipmentCard s={s} />
            </li>
          ))}
        </ol>
      )}

      {all.length > 0 && (
        <div className="mt-6">
          <LinkButton href="/shipments/new">Clear another shipment</LinkButton>
        </div>
      )}
    </main>
  );
}

type Row = ReturnType<typeof toPlain<Awaited<ReturnType<typeof listShipments>>>>["shipments"][number];

/** One shipment, laid out like an order: a summary strip, the status, and what to do next. */
function ShipmentCard({ s }: { s: Row }) {
  const href = `/shipments/${s.id}`;
  const invoice = s.invoices[0];
  const lines = s._count.items;
  const primary =
    s.status === "AWAITING_PAYMENT" ? { label: "Pay now", variant: "buy" as const }
    : s.status === "QUOTE_READY" ? { label: "Review your quote", variant: "buy" as const }
    : s.status === "DRAFT" || s.status === "DOCUMENTS_REQUIRED" ? { label: "Upload the invoice", variant: "primary" as const }
    : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-ink/15 bg-paper-sunk/70 px-5 py-3 text-xs text-ink-500">
        <div>
          <p className="uppercase tracking-wide">Opened</p>
          <p className="mt-0.5 text-sm text-ink">{date(s.createdAt)}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Goods value</p>
          <p className="num mt-0.5 text-sm text-ink">{money(s.goodsValue)}</p>
        </div>
        {invoice && (
          <div>
            <p className="uppercase tracking-wide">Invoice total</p>
            <p className="num mt-0.5 text-sm text-ink">{money(invoice.total)}</p>
          </div>
        )}
        <div className="min-w-0">
          <p className="uppercase tracking-wide">Waiting at</p>
          <p className="mt-0.5 truncate text-sm text-ink">{s.heldAt ?? "Not given"}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="uppercase tracking-wide">Shipment <span className="num">{s.reference}</span></p>
          <Link href={href} className="mt-0.5 inline-block text-sm text-ink underline decoration-ink-300 underline-offset-2 hover:decoration-ink">
            View details
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className={cn("text-lg font-bold", NEEDS_YOU.includes(s.status) && "text-alert")}>{s.statusLabel}</p>
          <p className="mt-1 text-sm text-ink-700">
            {s.description ?? s.items[0]?.description ?? "Shipment"}
            {lines > 1 ? <span className="text-ink-500"> · {lines} items</span> : null}
          </p>
          <p className="mt-1 text-xs text-ink-500">{s.deliveryRequested ? "We'll deliver once it clears" : "You'll collect once it clears"}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-56">
          {primary && <LinkButton href={href} variant={primary.variant} className="w-full">{primary.label}</LinkButton>}
          <LinkButton href={href} variant="secondary" className="w-full">Track shipment</LinkButton>
        </div>
      </div>
    </Card>
  );
}
