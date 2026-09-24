import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageUser } from "@/lib/auth/page";
import { can, isStaff } from "@/lib/auth/rbac";
import { getShipment } from "@/lib/services/shipment-queries";
import { paymentInstructions } from "@/lib/services/invoice-service";
import { DomainError } from "@/lib/services/errors";
import { summariseCharges, type LandedCostResult } from "@/lib/domain/landed-cost";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChargeBreakdown } from "@/components/charge-breakdown";
import { Milestones } from "@/components/milestones";
import { UploadForm } from "@/components/shipment/upload-form";
import { AcceptQuoteButton } from "@/components/shipment/accept-quote-button";
import { WithdrawButton } from "@/components/shipment/withdraw-button";
import { DOCUMENT_KIND, INVOICE_STATUS } from "@/components/shipment/labels";
import { date, dateTime, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Shipment" };

const EARLY = ["DRAFT", "DOCUMENTS_REQUIRED", "DOCUMENTS_RECEIVED"];
const OPEN_INVOICE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser({ next: `/shipments/${id}` });
  if (isStaff(user.role)) redirect(`/ops/shipments/${id}`);
  if (!can(user.role, "shipment:read:own")) notFound();

  let s;
  try {
    s = toPlain(await getShipment(user, id));
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  }

  const quote = [...s.quotes].reverse().find((q) => q.status === "ISSUED" || q.status === "ACCEPTED") ?? null;
  const openInvoice = s.invoices.find((i) => OPEN_INVOICE.includes(i.status)) ?? null;
  const payment =
    openInvoice && s.status === "AWAITING_PAYMENT" ? await paymentInstructions(user, openInvoice.id).catch(() => null) : null;
  const estimate = s.estimate as unknown as LandedCostResult | null;
  const hasInvoiceDoc = s.documents.some((d) => d.kind === "COMMERCIAL_INVOICE");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="text-sm font-medium text-ink-500 hover:text-ink">← Your shipments</Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-sm font-semibold uppercase tracking-wider text-ink-500">{s.reference}</p>
          <h1 className="text-title font-bold">{s.statusLabel}</h1>
          <p className="mt-1 text-ink-500">
            {s.description ?? "Shipment"}
            {s.heldAt ? ` · waiting at ${s.heldAt}` : ""} · {s.deliveryRequested ? "we'll deliver" : "you'll collect"}
            {s.supplier ? ` · from ${s.supplier.name}` : ""} · opened {date(s.createdAt)}
          </p>
        </div>
        {EARLY.includes(s.status) && <WithdrawButton shipmentId={s.id} />}
      </header>

      <Card className="mt-6 px-5 py-5">
        <Milestones milestones={s.milestones} cancelled={s.status === "CANCELLED"} />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <NextStep
            status={s.status}
            shipmentId={s.id}
            hasInvoiceDoc={hasInvoiceDoc}
            quote={quote}
            payment={payment}
            deliveredAt={s.delivery?.deliveredAt ?? null}
            deliveryRequested={s.deliveryRequested}
            heldAt={s.heldAt}
          />

          <Card>
            <CardHeader title="Items" eyebrow={`${s.items.length} ${s.items.length === 1 ? "line" : "lines"}`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Item</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Value</th>
                    <th className="px-5 py-2.5 font-semibold">Tariff code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {s.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-3">{i.description}</td>
                      <td className="num px-5 py-3 text-right">{Number(i.quantity)}</td>
                      <td className="num px-5 py-3 text-right">{money(i.lineValue)}</td>
                      <td className="px-5 py-3">
                        {i.classified ? (
                          <span className="num font-medium" title={i.hsDescription ?? undefined}>{i.hsCode}</span>
                        ) : (
                          <span className="text-ink-500">Awaiting broker review</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-ink/10 text-sm">
                  <tr><td className="px-5 pt-3 text-ink-500" colSpan={2}>Goods</td><td className="num px-5 pt-3 text-right">{money(s.goodsValue)}</td><td /></tr>
                  <tr><td className="px-5 text-ink-500" colSpan={2}>Freight</td><td className="num px-5 text-right">{money(s.freightCost)}</td><td /></tr>
                  <tr><td className="px-5 pb-3 text-ink-500" colSpan={2}>Insurance</td><td className="num px-5 pb-3 text-right">{money(s.insuranceCost)}</td><td /></tr>
                </tfoot>
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
                    </li>
                  ))}
                </ul>
              )}
              {s.status !== "DELIVERED" && s.status !== "CANCELLED" && (
                <UploadForm shipmentId={s.id} defaultKind={hasInvoiceDoc ? "OTHER" : "COMMERCIAL_INVOICE"} compact />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 p-5 text-sm">
              {[...s.history].reverse().map((h, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>{h.label}</span>
                  <span className="shrink-0 text-ink-500">{dateTime(h.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            {quote ? (
              <>
                <CardHeader
                  eyebrow={quote.status === "ACCEPTED" ? "Accepted quote" : "Your quote"}
                  title={<span className="num">{quote.reference}</span>}
                  action={quote.brokerApproved ? <Badge tone="good">Broker reviewed</Badge> : <Badge tone="warn">In review</Badge>}
                />
                <ChargeBreakdown
                  className="p-5"
                  charges={quote.charges}
                  customsValue={quote.customsValue}
                  governmentTotal={quote.governmentTotal}
                  brokerTotal={quote.brokerTotal}
                  grandTotal={quote.grandTotal}
                />
                {quote.expiresAt && quote.status === "ISSUED" && (
                  <p className="border-t border-ink/10 px-5 py-3 text-xs text-ink-500">Valid until {date(quote.expiresAt)}.</p>
                )}
              </>
            ) : estimate ? (
              <>
                <CardHeader eyebrow="Estimate" title="What this should cost" />
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
                {estimate.unclassifiedLines.length > 0 && (
                  <p className="border-t border-ink/10 px-5 py-3 text-xs text-ink-500">
                    A licensed broker hasn't classified every item yet, so this uses the general duty rate for those
                    lines. Your quote will use the rate for each item's tariff code.
                  </p>
                )}
              </>
            ) : (
              <p className="p-5 text-sm text-ink-500">Add your items to see an estimate.</p>
            )}
          </Card>

          {s.invoices.length > 0 && (
            <Card>
              <CardHeader title="Invoices" />
              <ul className="divide-y divide-ink/10 text-sm">
                {s.invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <span>
                      <span className="num font-medium">{inv.reference}</span>
                      <span className="block text-ink-500">{INVOICE_STATUS[inv.status]}</span>
                    </span>
                    <span className="text-right">
                      <span className="num block font-semibold">{money(inv.total)}</span>
                      {Number(inv.amountPaid) > 0 && inv.status !== "PAID" && (
                        <span className="num block text-xs text-ink-500">{money(inv.amountPaid)} paid</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

function NextStep({
  status, shipmentId, hasInvoiceDoc, quote, payment, deliveredAt, deliveryRequested, heldAt,
}: {
  status: string;
  shipmentId: string;
  hasInvoiceDoc: boolean;
  quote: { id: string; status: string; brokerApproved: boolean } | null;
  payment: { reference: string; outstanding: string; instructions?: string } | null;
  deliveredAt: string | null;
  deliveryRequested: boolean;
  heldAt: string | null;
}) {
  const panel = (title: string, body: React.ReactNode, tone: "action" | "info" = "info") => (
    <Card className={tone === "action" ? "ring-2 ring-ink" : undefined}>
      <CardHeader eyebrow={tone === "action" ? "What we need from you" : "What happens next"} title={title} />
      <div className="space-y-4 p-5 text-sm leading-relaxed text-ink-700">{body}</div>
    </Card>
  );

  if ((status === "DRAFT" || status === "DOCUMENTS_REQUIRED") && !hasInvoiceDoc) {
    return panel(
      "Upload your supplier's invoice",
      <>
        <p>We can't start your customs entry until we have the commercial invoice: the seller's bill showing what you bought and what you paid.</p>
        <UploadForm shipmentId={shipmentId} />
      </>,
      "action",
    );
  }
  if (status === "QUOTE_READY" && quote?.status === "ISSUED" && quote.brokerApproved) {
    return panel(
      "Your quote is ready",
      <>
        <p>A licensed broker has reviewed your items. Check the quote, then accept it to get your invoice.</p>
        <AcceptQuoteButton quoteId={quote.id} />
      </>,
      "action",
    );
  }
  if (status === "AWAITING_PAYMENT" && payment) {
    return panel(
      "Pay your invoice",
      <>
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-ink-500">Amount due</dt><dd className="num text-xl font-bold text-ink">{money(payment.outstanding)}</dd></div>
          <div><dt className="text-ink-500">Quote this reference</dt><dd className="num text-xl font-bold text-ink">{payment.reference}</dd></div>
        </dl>
        <p>{payment.instructions}</p>
      </>,
      "action",
    );
  }

  const info: Record<string, [string, string]> = {
    DRAFT: ["We have your invoice", "We'll start checking your paperwork shortly."],
    DOCUMENTS_REQUIRED: ["We have your invoice", "We'll start checking your paperwork shortly."],
    DOCUMENTS_RECEIVED: ["We're checking your paperwork", "Once a licensed broker has classified your items, we'll send you a quote."],
    UNDER_REVIEW: ["We're checking your paperwork", "Once a licensed broker has classified your items, we'll send you a quote."],
    CLASSIFICATION_REVIEW: ["A broker is reviewing your items", "Each item needs a tariff code before we can quote. We'll email you when your quote is ready."],
    QUOTE_READY: ["We're finalising your quote", "A licensed broker is checking it. You'll be able to accept it here."],
    PAID: ["Payment received, thank you", "We're preparing your customs entry now."],
    DECLARATION_PREPARED: ["Entry prepared", "A licensed broker is about to submit it to Bahamas Customs."],
    SUBMITTED_TO_CUSTOMS: ["With Bahamas Customs", "Your entry has been submitted. Most clear within a day or two."],
    CUSTOMS_REVIEW: ["Bahamas Customs is reviewing it", "Nothing is needed from you. We'll tell you when it clears."],
    CUSTOMS_HOLD: ["Held by Bahamas Customs", "Customs has asked to look more closely. We're working on it and will tell you as soon as anything changes."],
    DUTIES_DUE: ["Duties assessed", "Bahamas Customs has assessed the duty. We'll be in touch if anything differs from your quote."],
    CUSTOMS_RELEASED: deliveryRequested
      ? ["Released by customs", "We're arranging delivery and will call you to confirm a time."]
      : ["Released, ready to collect", `Your goods can be collected${heldAt ? ` from ${heldAt}` : ""}. We'll tell you what to bring.`],
    READY_FOR_DELIVERY: ["Ready for delivery", "We'll be in touch to arrange a time."],
    OUT_FOR_DELIVERY: ["Out for delivery today", "Your driver is on the way."],
    DELIVERED: deliveryRequested
      ? ["Delivered", deliveredAt ? `Delivered on ${date(deliveredAt)}. Thanks for importing with Kencole.` : "Thanks for importing with Kencole."]
      : ["Collected", "Thanks for clearing with Kencole."],
    CANCELLED: ["Cancelled", "This shipment was cancelled. Nothing more is owed on it."],
  };
  const [title, body] = info[status] ?? ["In progress", "We'll keep you posted."];
  return panel(title, <p>{body}</p>);
}
