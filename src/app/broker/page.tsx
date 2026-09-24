import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { brokerQueue, type BoardCard } from "@/lib/services/ops-queries";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/staff/severity";
import { money, toPlain, type Jsonify } from "@/lib/format";

export const metadata: Metadata = { title: "Broker review" };
export const dynamic = "force-dynamic";

export default async function BrokerPage() {
  const user = await pageUser({ next: "/broker", capability: "classification:approve" });
  const { toClassify, toSubmit } = toPlain(await brokerQueue(user));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-title font-bold">Broker review</h1>
      <p className="mt-1 max-w-2xl text-ink-500">
        Classifications and entries that need a licensed broker. The system suggests tariff codes; only you decide them.
      </p>

      <Card className="mt-8">
        <CardHeader title={<>Lines to classify <span className="num ml-1 text-ink-500">{toClassify.reduce((n, s) => n + s.lines - s.approvedLines, 0)}</span></>} eyebrow="Oldest first" />
        <Queue rows={toClassify} empty="Every line on every open shipment has a broker decision." />
      </Card>

      <Card className="mt-6">
        <CardHeader title={<>Entries ready to submit <span className="num ml-1 text-ink-500">{toSubmit.length}</span></>} eyebrow="Prepared declarations" />
        <Queue rows={toSubmit} empty="No prepared entries waiting." />
      </Card>
    </main>
  );
}

function Queue({ rows, empty }: { rows: Jsonify<BoardCard>[]; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-ink-500">{empty}</p>;
  return (
    <ul className="divide-y divide-ink/10">
      {rows.map((s) => (
        <li key={s.id}>
          <Link href={`/broker/review/${s.id}`} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-paper/60">
            <span>
              <span className="num font-semibold">{s.reference}</span>
              <span className="ml-2 text-sm text-ink-500">{s.customer} · {s.description ?? "—"}</span>
            </span>
            <span className="flex items-center gap-3 text-sm">
              {s.worstSeverity && <SeverityBadge severity={s.worstSeverity} />}
              <span className="text-ink-500">{s.statusLabel}</span>
              <span className="num">{s.approvedLines}/{s.lines} lines</span>
              <span className="num w-24 text-right">{money(s.goodsValue)}</span>
              {s.stale ? <Badge tone="warn">{s.hoursInStatus}h waiting</Badge> : <span className="num w-20 text-right text-ink-500">{s.hoursInStatus}h</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
