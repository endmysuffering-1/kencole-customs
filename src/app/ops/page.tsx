import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { opsBoard, type BoardCard } from "@/lib/services/ops-queries";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/staff/severity";
import { cn } from "@/lib/cn";
import { date, money, toPlain, type Jsonify } from "@/lib/format";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const user = await pageUser({ next: "/ops", capability: "ops:queue" });
  const board = toPlain(await opsBoard(user));
  const open = board.queues.reduce((n, q) => n + q.shipments.length, 0);
  const critical = board.exceptions.filter((e) => e.severity === "CRITICAL").length;
  const outstanding = board.unpaid.reduce((sum, i) => sum + Number(i.total) - Number(i.amountPaid), 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-title font-bold">Operations</h1>

      <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open shipments" value={open} />
        <Stat label="Past their time in status" value={board.staleCount} tone={board.staleCount ? "warn" : undefined} />
        <Stat label="Critical exceptions" value={critical} tone={critical ? "alert" : undefined} />
        <Stat label="Awaiting payment" value={money(outstanding)} sub={`${board.unpaid.length} invoices`} />
      </dl>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          {board.queues.map((q) => (
            <Card key={q.key} id={q.key}>
              <CardHeader
                title={<>{q.title} <span className="num ml-1 text-ink-500">{q.shipments.length}</span></>}
                eyebrow={q.hint}
              />
              {q.shipments.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-500">Nothing here.</p>
              ) : (
                <QueueTable rows={q.shipments} />
              )}
            </Card>
          ))}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Open exceptions" eyebrow="Most serious first" />
            {board.exceptions.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">None open.</p>
            ) : (
              <ul className="max-h-[36rem] divide-y divide-ink/10 overflow-y-auto text-sm">
                {board.exceptions.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/ops/shipments/${e.shipment.id}`} className="num font-semibold hover:underline">{e.shipment.reference}</Link>
                      <SeverityBadge severity={e.severity} />
                    </div>
                    <p className="mt-1 text-ink-700">{e.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Payments to watch for" eyebrow="Record them as they arrive" />
            {board.unpaid.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">Every invoice is settled.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-ink/10">
                  {board.unpaid.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-2.5">
                        {i.shipment ? (
                          <Link href={`/ops/shipments/${i.shipment.id}`} className="num font-semibold hover:underline">{i.reference}</Link>
                        ) : (
                          <span className="num font-semibold">{i.reference}</span>
                        )}
                        <span className="block text-xs text-ink-500">Due {date(i.dueAt)}{i.status === "OVERDUE" ? " · overdue" : ""}</span>
                      </td>
                      <td className="num px-5 py-2.5 text-right font-medium">{money(Number(i.total) - Number(i.amountPaid))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "alert" }) {
  return (
    <Card className={cn("px-5 py-4", tone === "alert" && "ring-2 ring-alert/40", tone === "warn" && "ring-2 ring-alert/20")}>
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className="num mt-1 text-2xl font-bold">{value}</dd>
      {sub && <dd className="text-xs text-ink-500">{sub}</dd>}
    </Card>
  );
}

function QueueTable({ rows }: { rows: Jsonify<BoardCard>[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-ink-500">
          <tr>
            <th className="px-5 py-2 font-semibold">Shipment</th>
            <th className="px-5 py-2 font-semibold">Customer</th>
            <th className="px-5 py-2 font-semibold">Status</th>
            <th className="px-5 py-2 text-right font-semibold">Lines approved</th>
            <th className="px-5 py-2 text-right font-semibold">Goods</th>
            <th className="px-5 py-2 text-right font-semibold">In status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-paper/60">
              <td className="px-5 py-2.5">
                <Link href={`/ops/shipments/${s.id}`} className="num font-semibold hover:underline">{s.reference}</Link>
                <span className="block max-w-[16rem] truncate text-xs text-ink-500">{s.description ?? "—"}</span>
              </td>
              <td className="px-5 py-2.5">{s.customer}</td>
              <td className="px-5 py-2.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  {s.statusLabel}
                  {s.worstSeverity && <SeverityBadge severity={s.worstSeverity} />}
                </span>
              </td>
              <td className="num px-5 py-2.5 text-right">{s.approvedLines}/{s.lines}</td>
              <td className="num px-5 py-2.5 text-right">{money(s.goodsValue)}</td>
              <td className="num px-5 py-2.5 text-right">
                {s.stale ? <Badge tone="warn">{hours(s.hoursInStatus)}</Badge> : <span className="text-ink-500">{hours(s.hoursInStatus)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const hours = (h: number) => (h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`);
