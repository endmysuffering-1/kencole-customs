import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageUser } from "@/lib/auth/page";
import { getShipment } from "@/lib/services/shipment-queries";
import { DomainError } from "@/lib/services/errors";
import { cn } from "@/lib/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { DOCUMENT_KIND, FREIGHT_MODE } from "@/components/shipment/labels";
import { ActionButton } from "@/components/staff/action-button";
import { SeverityBadge } from "@/components/staff/severity";
import { LineDecision, type ReviewLine } from "@/components/broker/line-decision";
import { money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Review · Broker" };

const PREVIEWABLE = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export default async function BrokerReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { id } = await params;
  const { doc } = await searchParams;
  const user = await pageUser({ next: `/broker/review/${id}`, capability: "classification:approve" });

  let s;
  try {
    s = toPlain(await getShipment(user, id));
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  }

  const shown =
    s.documents.find((d) => d.id === doc) ??
    s.documents.find((d) => d.kind === "COMMERCIAL_INVOICE") ??
    s.documents[0] ??
    null;
  const approved = s.items.filter((i) => i.classified).length;
  const allApproved = s.items.length > 0 && approved === s.items.length;
  const liveQuote = s.quotes.find((q) => q.status === "ISSUED" || q.status === "ACCEPTED");

  return (
    <main className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/broker" className="text-sm font-medium text-ink-500 hover:text-ink">← Broker review</Link>
          <h1 className="mt-1 text-title font-bold">
            <span className="num">{s.reference}</span> <span className="text-ink-500">· {s.statusLabel}</span>
          </h1>
          <p className="text-sm text-ink-500">
            {s.business ? s.business.name : s.owner?.fullName} · {FREIGHT_MODE[s.freightMode]}
            {s.heldAt ? ` · at ${s.heldAt}` : ""}
            {s.supplier ? ` · ${s.supplier.name}${s.supplier.country ? ` (${s.supplier.country})` : ""}` : ""}
          </p>
        </div>
        <LinkButton variant="secondary" href={`/ops/shipments/${s.id}`}>Full shipment record</LinkButton>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Left: the source document, as the customer sent it. */}
        <section className="lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden">
            {s.documents.length > 1 && (
              <nav className="flex gap-1 overflow-x-auto border-b border-ink/10 px-3 py-2" aria-label="Documents">
                {s.documents.map((d) => (
                  <Link
                    key={d.id}
                    href={`?doc=${d.id}`}
                    replace
                    className={cn(
                      "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
                      d.id === shown?.id ? "bg-ink text-white" : "text-ink-700 hover:bg-paper-sunk",
                    )}
                  >
                    {DOCUMENT_KIND[d.kind]}
                  </Link>
                ))}
              </nav>
            )}
            {shown ? (
              PREVIEWABLE.includes(shown.mimeType) ? (
                <iframe
                  key={shown.id}
                  src={`/api/v1/documents/${shown.id}${shown.mimeType === "application/pdf" ? "#navpanes=0&view=FitH" : ""}`}
                  title={shown.fileName}
                  className="h-[75vh] w-full bg-paper-sunk"
                />
              ) : (
                <div className="p-8 text-center text-sm text-ink-500">
                  <p>{shown.fileName} can't be previewed here.</p>
                  <a href={`/api/v1/documents/${shown.id}`} className="mt-2 inline-block font-semibold text-ink underline decoration-ink-300 underline-offset-2 hover:decoration-ink">Download it</a>
                </div>
              )
            ) : (
              <div className="p-8 text-center text-sm text-ink-500">No documents on file. Classify from the declared descriptions with care.</div>
            )}
          </Card>
        </section>

        {/* Right: what was declared, and the decisions. */}
        <section className="space-y-6">
          <Card>
            <CardHeader title="Declared values" />
            <dl className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
              <div><dt className="text-ink-500">Goods</dt><dd className="num font-semibold">{money(s.goodsValue)}</dd></div>
              <div><dt className="text-ink-500">Freight</dt><dd className="num font-semibold">{money(s.freightCost)}</dd></div>
              <div><dt className="text-ink-500">Insurance</dt><dd className="num font-semibold">{money(s.insuranceCost)}</dd></div>
              <div><dt className="text-ink-500">Currency</dt><dd className="font-semibold">{s.currency}</dd></div>
            </dl>
          </Card>

          {s.exceptions && s.exceptions.length > 0 && (
            <Card>
              <CardHeader title="Flags on this shipment" />
              <ul className="divide-y divide-ink/10 text-sm">
                {s.exceptions.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-4 px-5 py-2.5">
                    <span>{e.message}</span>
                    <SeverityBadge severity={e.severity} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Classification"
              eyebrow={`${approved} of ${s.items.length} lines approved`}
              action={allApproved ? <Badge tone="good">All lines approved</Badge> : undefined}
            />
            <ul className="divide-y divide-ink/10">
              {s.items.map((i) => (
                <LineDecision
                  key={`${i.id}:${i.classificationStatus}:${i.hsCode}`}
                  money={money(i.lineValue)}
                  line={{
                    id: i.id,
                    lineNumber: i.lineNumber,
                    description: i.description,
                    quantity: String(i.quantity),
                    lineValue: String(i.lineValue),
                    originCountry: i.originCountry,
                    hsCode: i.hsCode,
                    hsDescription: i.hsDescription,
                    suggestedHsCode: i.suggestedHsCode ?? null,
                    confidence: i.confidence != null ? String(i.confidence) : null,
                    classificationStatus: i.classificationStatus ?? "UNCLASSIFIED",
                    brokerNote: i.brokerNote ?? null,
                  } satisfies ReviewLine}
                />
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Next" />
            <div className="flex flex-wrap items-start gap-3 p-5 text-sm">
              {["UNDER_REVIEW", "CLASSIFICATION_REVIEW"].includes(s.status) && allApproved && (
                <ActionButton variant="primary" path={`/shipments/${s.id}/transitions`} body={{ to: "QUOTE_READY" }}>
                  Mark ready to quote
                </ActionButton>
              )}
              {s.status === "QUOTE_READY" && allApproved && !liveQuote?.brokerApproved && (
                <ActionButton variant="primary" path={`/shipments/${s.id}/quotes`}>Issue broker-approved quote</ActionButton>
              )}
              {s.status === "DECLARATION_PREPARED" && (
                <ActionButton
                  variant="primary"
                  path={`/shipments/${s.id}/transitions`}
                  body={{ to: "SUBMITTED_TO_CUSTOMS" }}
                  confirm="Submit this entry to Bahamas Customs under your licence?"
                >
                  Submit entry to customs
                </ActionButton>
              )}
              {!allApproved && <p className="text-ink-500">Decide every line to move this shipment on.</p>}
              {allApproved && s.status === "QUOTE_READY" && liveQuote?.brokerApproved && (
                <p className="text-ink-500">Quote <span className="num">{liveQuote.reference}</span> is with the customer.</p>
              )}
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
