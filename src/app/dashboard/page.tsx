import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { listShipments } from "@/lib/services/shipment-queries";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { date, money } from "@/lib/format";

export const metadata: Metadata = { title: "My shipments" };

const NEEDS_YOU = new Set(["DRAFT", "DOCUMENTS_REQUIRED", "QUOTE_READY", "AWAITING_PAYMENT"]);

export default async function Dashboard() {
  const user = await pageUser({ next: "/dashboard", capability: "shipment:read:own" });
  const { shipments } = await listShipments(user);
  const waiting = shipments.filter((s) => NEEDS_YOU.has(s.status));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-bold">My shipments</h1>
          <p className="mt-1 text-ink-500">
            {waiting.length > 0
              ? `${waiting.length} ${waiting.length === 1 ? "shipment needs" : "shipments need"} something from you.`
              : "Nothing needs your attention right now."}
          </p>
        </div>
        <LinkButton href="/shipments/new">New shipment</LinkButton>
      </div>

      {shipments.length === 0 ? (
        <Card className="mt-8 px-6 py-12 text-center">
          <h2 className="text-lg font-semibold">No shipments yet</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-500">
            Tell us what's arrived and where it's waiting. We'll estimate the duty, VAT and our fees before you pay anything.
          </p>
          <LinkButton href="/shipments/new" className="mt-6">Start a shipment</LinkButton>
        </Card>
      ) : (
        <Card className="mt-8 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-sunk text-left text-xs uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Shipment</th>
                  <th className="px-5 py-3 font-semibold">Where it is</th>
                  <th className="px-5 py-3 text-right font-semibold">Goods value</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {shipments.map((s) => (
                  <tr key={s.id} className="hover:bg-paper/60">
                    <td className="px-5 py-3.5">
                      <Link href={`/shipments/${s.id}`} className="font-semibold hover:underline">{s.reference}</Link>
                      <span className="block text-ink-500">{s.description ?? "—"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {NEEDS_YOU.has(s.status) ? <Badge tone="warn">{s.statusLabel}</Badge> : <span>{s.statusLabel}</span>}
                    </td>
                    <td className="num px-5 py-3.5 text-right">{money(s.goodsValue.toString())}</td>
                    <td className="px-5 py-3.5 text-ink-500">{date(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
