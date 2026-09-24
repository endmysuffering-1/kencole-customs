import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { findShipmentByReference, listShipments } from "@/lib/services/shipment-queries";
import { searchTariff } from "@/lib/services/tariff-service";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { date, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Search" };

const REFERENCE = /^[A-Z]{2,5}-\d{4}-\d{6}$/i;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; in?: string }> }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const scope = params.in === "tariff" || params.in === "shipments" ? params.in : "all";
  const user = await getSessionUser();

  // A shipment reference goes straight to the shipment, if this person may see it.
  if (q && REFERENCE.test(q) && user) {
    const found = await findShipmentByReference(user, q);
    if (found) redirect(isStaff(user.role) ? `/ops/shipments/${found.id}` : `/shipments/${found.id}`);
  }

  const [codes, shipments] = await Promise.all([
    q && scope !== "shipments" ? searchTariff(q, 30) : Promise.resolve([]),
    q && user && scope !== "tariff" ? listShipments(user, { q, take: 20 }).then((r) => toPlain(r.shipments)) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {!q ? (
        <p className="text-ink-500">Search tariff codes by product or number{user ? ", or your shipments by reference or item" : ""}.</p>
      ) : (
        <p className="text-sm text-ink-700">
          {codes.length + shipments.length} {codes.length + shipments.length === 1 ? "result" : "results"} for{" "}
          <span className="font-bold text-ink">&ldquo;{q}&rdquo;</span>
        </p>
      )}

      {q && REFERENCE.test(q) && !user && (
        <Card className="mt-6 p-5">
          <p className="font-semibold">Looking for shipment {q.toUpperCase()}?</p>
          <p className="mt-1 text-sm text-ink-500">Sign in to see your shipments.</p>
          <LinkButton href={`/login?next=${encodeURIComponent(`/search?q=${q}`)}`} className="mt-4">Sign in</LinkButton>
        </Card>
      )}

      {shipments.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Your shipments</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {shipments.map((s) => (
              <li key={s.id}>
                <Link href={isStaff(user!.role) ? `/ops/shipments/${s.id}` : `/shipments/${s.id}`} className="block h-full">
                  <Card className="h-full p-4 hover:border-ink/40">
                    <p className="num text-xs text-ink-500">{s.reference} · opened {date(s.createdAt)}</p>
                    <p className="mt-1 font-bold">{s.statusLabel}</p>
                    <p className="text-sm text-ink-700">{s.description ?? s.items[0]?.description ?? "Shipment"}</p>
                    <p className="num mt-2 text-sm">{money(s.goodsValue)}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {codes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Tariff codes</h2>
          <p className="text-sm text-ink-500">
            A licensed broker confirms the code for every item before you're quoted. This list helps you estimate.
          </p>
          <ul className="mt-3 divide-y divide-ink/10 rounded-card border border-ink/15 bg-white">
            {codes.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="num font-bold">{c.code}</span>
                  <span className="ml-3 text-sm text-ink-700">{c.description}</span>
                </span>
                <LinkButton variant="secondary" href={`/?hs=${encodeURIComponent(c.code)}#estimate`} className="px-4 py-1.5 text-xs">
                  Estimate duty
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {q && codes.length === 0 && shipments.length === 0 && !(REFERENCE.test(q) && !user) && (
        <Card className="mt-6 p-5">
          <p className="font-semibold">No results for &ldquo;{q}&rdquo;.</p>
          <p className="mt-1 text-sm text-ink-500">
            Try a simpler word, such as &ldquo;shirt&rdquo; or &ldquo;laptop&rdquo;, or the first digits of a tariff code.
          </p>
        </Card>
      )}
    </main>
  );
}
