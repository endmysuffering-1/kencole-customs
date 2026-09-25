import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { listShipments } from "@/lib/services/shipment-queries";
import { CUSTOMER_ACTION_STATUSES } from "@/lib/domain/shipment-state";
import { LinkButton } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { ShipmentStatusBadge } from "@/components/shipment/status-badge";
import { cn } from "@/lib/cn";
import { date, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Your shipments" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "needs-you", label: "Needs you" },
  { key: "in-progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const needs = (s: string) => (CUSTOMER_ACTION_STATUSES as string[]).includes(s);
const matches = (f: Filter, s: string) =>
  f === "all" ||
  (f === "needs-you" && needs(s)) ||
  (f === "completed" && s === "DELIVERED") ||
  (f === "cancelled" && s === "CANCELLED") ||
  (f === "in-progress" && !needs(s) && s !== "DELIVERED" && s !== "CANCELLED");

/** DockDrop's package list: a toolbar, a header row, and one row per shipment. */
export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await pageUser({ next: "/shipments", capability: "shipment:read:own" });
  const params = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.key === params.status) ? (params.status as Filter) : "all";
  const q = params.q?.trim().slice(0, 100) || undefined;
  const { shipments: all } = toPlain(await listShipments(user, { q, take: 100 }));
  const rows = all.filter((s) => matches(filter, s.status));

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <form action="/shipments" className="mb-4 flex flex-wrap gap-2">
        <label htmlFor="list-q" className="sr-only">Search your shipments</label>
        <input id="list-q" name="q" defaultValue={q} placeholder="Search by reference or item" className={cn(inputClass, "max-w-xs flex-[1_1_12rem]")} />
        <label htmlFor="list-status" className="sr-only">Status</label>
        <select id="list-status" name="status" defaultValue={filter} className={cn(inputClass, "max-w-[11rem] flex-[1_1_8rem]")}>
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}{f.key !== "all" ? ` (${all.filter((s) => matches(f.key, s.status)).length})` : ""}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-field bg-ocean px-4 text-sm font-semibold text-white hover:bg-ink-700">Filter</button>
        <LinkButton href="/shipments/new" className="ml-auto px-4 py-2">+ Clear a shipment</LinkButton>
      </form>

      <div className="space-y-2.5">
        <div className="hidden grid-cols-[2.5fr_1.3fr_1fr_1fr_1fr] gap-3 rounded-[8px] bg-paper-sunk px-5 py-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-ink-500 md:grid">
          <span>Shipment</span><span>Status</span><span className="text-right">Goods value</span><span className="text-right">Invoice</span><span className="text-right">Opened</span>
        </div>
        {rows.map((s) => {
          const invoice = s.invoices[0];
          return (
            <Link
              key={s.id}
              href={`/shipments/${s.id}`}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-field border border-line bg-white px-5 py-4 transition hover:-translate-y-px hover:border-line-hover hover:shadow-card md:grid-cols-[2.5fr_1.3fr_1fr_1fr_1fr]"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {s.description ?? s.items[0]?.description ?? "Shipment"}
                  {s._count.items > 1 && <span className="font-normal text-ink-500"> · {s._count.items} items</span>}
                </span>
                <span className="block truncate font-mono text-xs text-ink-500">
                  {s.reference}{s.heldAt ? ` · ${s.heldAt}` : ""}
                </span>
              </span>
              <span className="row-span-2 self-center md:row-span-1"><ShipmentStatusBadge status={s.status} label={s.statusLabel} /></span>
              <span className="num hidden text-right text-sm font-semibold md:block">{money(s.goodsValue)}</span>
              <span className="num hidden text-right text-sm md:block">{invoice ? money(invoice.total) : <span className="text-ink-300">—</span>}</span>
              <span className="hidden text-right text-sm text-ink-500 md:block">{date(s.createdAt)}</span>
            </Link>
          );
        })}
        {rows.length === 0 && (
          <div className="rounded-card border border-line bg-white p-8 text-center text-sm text-ink-500 shadow-card">
            {all.length === 0 ? (
              <>
                <p className="font-serif text-lg font-semibold text-ocean">No shipments yet</p>
                <p className="mt-1">Tell us what&apos;s arrived and where it&apos;s waiting.</p>
                <LinkButton href="/shipments/new" className="mt-4">Clear a shipment</LinkButton>
              </>
            ) : (
              "No shipments match."
            )}
          </div>
        )}
      </div>
    </main>
  );
}
