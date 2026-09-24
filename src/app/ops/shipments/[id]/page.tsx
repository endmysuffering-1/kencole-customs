import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser } from "@/lib/auth/page";
import { can } from "@/lib/auth/rbac";
import { getShipment } from "@/lib/services/shipment-queries";
import { STATUS_CAPABILITY } from "@/lib/services/shipment-service";
import { DomainError } from "@/lib/services/errors";
import { TRANSITIONS, label, type ShipmentStatus } from "@/lib/domain/shipment-state";
import { summariseCharges, type LandedCostResult } from "@/lib/domain/landed-cost";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ChargeBreakdown } from "@/components/charge-breakdown";
import { UploadForm } from "@/components/shipment/upload-form";
import { DOCUMENT_KIND, FREIGHT_MODE } from "@/components/shipment/labels";
import { ActionButton } from "@/components/staff/action-button";
import { StatusActions, type StatusOption } from "@/components/staff/status-actions";
import { RecordPaymentForm } from "@/components/staff/record-payment-form";
import { SeverityBadge } from "@/components/staff/severity";
import { CLASSIFICATION_TONE, classificationLabel } from "@/components/staff/classification";
import { date, dateTime, humanise, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Shipment · Operations" };

const OPEN_INVOICE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];
const QUOTABLE: ShipmentStatus[] = ["UNDER_REVIEW", "CLASSIFICATION_REVIEW", "QUOTE_READY"];

export default async function OpsShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser({ next: `/ops/shipments/${id}`, capability: "shipment:read:any" });

  let s;
  try {
    s = toPlain(await getShipment(user, id));
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  }

  const status = s.status as ShipmentStatus;
  // PAID follows from recording the payment, never from a click.
  const options: StatusOption[] = TRANSITIONS[status]
    .filter((to) => to !== "PAID")
    .map((to) => {
      const needed = STATUS_CAPABILITY[to];
      return {
        to,
        label: label(to),
        blockedBecause: needed && !can(user.role, needed) ? "Only a licensed customs broker can do this." : undefined,
      };
    });

  const liveQuote = [...s.quotes].reverse().find((q) => q.status === "ISSUED" || q.status === "ACCEPTED") ?? null;
  const estimate = s.estimate as unknown as LandedCostResult | null;
  const approved = s.items.filter((i) => i.classified).length;
  const isBroker = can(user.role, "classification:approve");

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Link href="/ops" className="text-sm font-medium text-ink-500 hover:text-ink">← Operations</Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-sm font-semibold uppercase tracking-wider text-ink-500">{s.reference}</p>
          <h1 className="text-title font-bold">{s.statusLabel}</h1>
          <p className="mt-1 text-ink-500">
            {s.business ? s.business.name : s.owner?.fullName} · {s.owner?.email} · {FREIGHT_MODE[s.freightMode]}
            {s.heldAt ? ` · at ${s.heldAt}` : ""} · {s.deliveryRequested ? "deliver" : "customer collects"}
            {s.supplier ? ` · ${s.supplier.name}` : ""}
            {s.trackingNumber ? ` · tracking ${s.trackingNumber}` : ""}
          </p>
        </div>
        {isBroker && <LinkButton href={`/broker/review/${s.id}`}>Open broker review</LinkButton>}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_26rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Move it on" eyebrow={`Currently ${label(status)}`} />
            <div className="p-5">
              {can(user.role, "shipment:transition") ? (
                <StatusActions shipmentId={s.id} options={options} />
              ) : (
                <p className="text-sm text-ink-500">Your role can't move shipments.</p>
              )}
              {status === "AWAITING_PAYMENT" && (
                <p className="mt-3 text-xs text-ink-500">It moves to Paid by itself when the invoice is settled below.</p>
              )}
            </div>
          </Card>

          {s.exceptions && s.exceptions.length > 0 && (
            <Card>
              <CardHeader title="Exceptions" eyebrow="Re-checked on every change" />
              <ul className="divide-y divide-ink/10 text-sm">
                {s.exceptions.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-4 px-5 py-3">
                    <span>{e.message}</span>
                    <SeverityBadge severity={e.severity} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Lines"
              eyebrow={`${approved} of ${s.items.length} approved by a broker`}
              action={isBroker ? <LinkButton variant="secondary" href={`/broker/review/${s.id}`}>Classify</LinkButton> : undefined}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-5 py-2 font-semibold">#</th>
                    <th className="px-5 py-2 font-semibold">Description</th>
                    <th className="px-5 py-2 text-right font-semibold">Qty</th>
                    <th className="px-5 py-2 text-right font-semibold">Value</th>
                    <th className="px-5 py-2 font-semibold">Suggested</th>
                    <th className="px-5 py-2 font-semibold">Tariff code</th>
                    <th className="px-5 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {s.items.map((i) => (
                    <tr key={i.id}>
                      <td className="num px-5 py-2.5 text-ink-500">{i.lineNumber}</td>
                      <td className="px-5 py-2.5">{i.description}</td>
                      <td className="num px-5 py-2.5 text-right">{Number(i.quantity)}</td>
                      <td className="num px-5 py-2.5 text-right">{money(i.lineValue)}</td>
                      <td className="px-5 py-2.5">
                        {i.suggestedHsCode ? (
                          <span className="num">{i.suggestedHsCode}{i.confidence != null && <span className="text-ink-500"> · {Math.round(Number(i.confidence) * 100)}%</span>}</span>
                        ) : can(user.role, "classification:suggest") && !i.classified ? (
                          <ActionButton variant="quiet" className="px-2 py-1 text-xs" path="/classification/suggestions" body={{ itemId: i.id }}>Suggest</ActionButton>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="num px-5 py-2.5 font-medium">{i.hsCode ?? <span className="font-normal text-ink-300">—</span>}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={CLASSIFICATION_TONE[i.classificationStatus ?? "UNCLASSIFIED"]}>{classificationLabel(i.classificationStatus)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Documents" />
            <div className="p-5">
              {s.documents.length > 0 && (
                <ul className="mb-5 divide-y divide-ink/10 text-sm">
                  {s.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-4 py-2.5">
                      <span>
                        <a href={`/api/v1/documents/${d.id}`} target="_blank" rel="noopener" className="font-medium hover:underline">{d.fileName}</a>
                        <span className="block text-ink-500">{DOCUMENT_KIND[d.kind]} · {date(d.createdAt)}</span>
                      </span>
                      <Badge tone={d.scanStatus === "CLEAN" ? "neutral" : "warn"}>{d.scanStatus.toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <UploadForm shipmentId={s.id} defaultKind="OTHER" compact />
            </div>
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 p-5 text-sm">
              {[...s.history].reverse().map((h, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>
                    {h.label}
                    {"note" in h && h.note && <span className="block text-ink-500">{h.note}</span>}
                  </span>
                  <span className="shrink-0 text-ink-500">{dateTime(h.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            {liveQuote ? (
              <>
                <CardHeader
                  eyebrow={liveQuote.status === "ACCEPTED" ? "Accepted quote" : "Issued quote"}
                  title={<span className="num">{liveQuote.reference}</span>}
                  action={liveQuote.brokerApproved ? <Badge tone="good">Broker approved</Badge> : <Badge tone="warn">Not broker approved</Badge>}
                />
                <ChargeBreakdown
                  className="p-5"
                  charges={liveQuote.charges}
                  customsValue={liveQuote.customsValue}
                  governmentTotal={liveQuote.governmentTotal}
                  brokerTotal={liveQuote.brokerTotal}
                  grandTotal={liveQuote.grandTotal}
                />
              </>
            ) : estimate ? (
              <>
                <CardHeader eyebrow="Working estimate" title="Not yet quoted" />
                <ChargeBreakdown
                  className="p-5"
                  charges={summariseCharges(estimate.charges).map((c) => ({
                    code: c.chargeCode, label: c.label, payee: c.payee, amount: c.amount, unverified: c.unverified,
                  }))}
                  goodsValue={estimate.goodsValue}
                  customsValue={estimate.customsValue}
                  governmentTotal={estimate.governmentTotal}
                  brokerTotal={estimate.brokerTotal}
                  grandTotal={estimate.grandTotal}
                />
              </>
            ) : (
              <p className="p-5 text-sm text-ink-500">No estimate yet.</p>
            )}
            {can(user.role, "quote:issue") && QUOTABLE.includes(status) && (
              <div className="border-t border-ink/10 px-5 py-4">
                <ActionButton
                  path={`/shipments/${s.id}/quotes`}
                  confirm={liveQuote ? "Issue a new quote? The current one will be superseded." : undefined}
                >
                  {liveQuote ? "Re-issue quote" : "Issue quote"}
                </ActionButton>
                {approved < s.items.length && (
                  <p className="mt-2 text-xs text-ink-500">
                    Not every line is broker-approved, so the customer won't be able to accept this quote yet.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Invoices" />
            {s.invoices.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">None yet. One is raised when the customer accepts a quote.</p>
            ) : (
              <ul className="divide-y divide-ink/10 text-sm">
                {s.invoices.map((inv) => {
                  const outstanding = (Number(inv.total) - Number(inv.amountPaid)).toFixed(2);
                  return (
                    <li key={inv.id} className="space-y-3 px-5 py-4">
                      <div className="flex items-center justify-between">
                        <span className="num font-semibold">{inv.reference}</span>
                        <Badge tone={inv.status === "PAID" ? "good" : OPEN_INVOICE.includes(inv.status) ? "warn" : "neutral"}>{humanise(inv.status)}</Badge>
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-ink-500">Government</dt><dd className="num text-sm font-medium">{money(inv.governmentTotal)}</dd></div>
                        <div><dt className="text-ink-500">Kencole</dt><dd className="num text-sm font-medium">{money(inv.brokerTotal)}</dd></div>
                        <div><dt className="text-ink-500">Paid</dt><dd className="num text-sm font-medium">{money(inv.amountPaid)}</dd></div>
                      </dl>
                      {can(user.role, "payment:record") && OPEN_INVOICE.includes(inv.status) && (
                        <RecordPaymentForm invoiceId={inv.id} outstanding={outstanding} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {(s.declaration || s.delivery) && (
            <Card>
              <CardHeader title="Entry and delivery" />
              <dl className="grid grid-cols-2 gap-3 p-5 text-sm">
                {s.declaration && (
                  <>
                    <div><dt className="text-ink-500">Entry</dt><dd className="num">{s.declaration.entryNumber ?? "Not lodged"}</dd></div>
                    <div><dt className="text-ink-500">Entry status</dt><dd>{humanise(s.declaration.status)}</dd></div>
                  </>
                )}
                {s.delivery && (
                  <>
                    <div><dt className="text-ink-500">Delivery</dt><dd>{humanise(s.delivery.status)}</dd></div>
                    <div><dt className="text-ink-500">Scheduled</dt><dd>{date(s.delivery.scheduledFor)}</dd></div>
                  </>
                )}
              </dl>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}
