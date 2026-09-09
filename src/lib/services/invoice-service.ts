import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { cents, money } from "@/lib/money";
import { DomainError } from "./shipment-service";
import { nextInvoiceReference } from "./references";

/**
 * Invoicing.
 *
 * The invoice carries two totals that never merge: governmentTotal is money we
 * collect and hand to the Public Treasury, brokerTotal is what Kencole earns.
 * Analytics reads brokerTotal only. Treating disbursements as revenue would
 * inflate turnover and misstate the tax position, so the split is enforced at
 * the point the invoice is built rather than corrected in reporting.
 */

export async function issueInvoiceForQuote(quoteId: string, actorId: string) {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: {
      charges: { include: { chargeType: true } },
      shipment: { include: { owner: true, business: true } },
    },
  });
  if (!quote) throw new DomainError("Quote not found.", 404);
  if (quote.status === "SUPERSEDED" || quote.status === "EXPIRED") {
    throw new DomainError("That quote is no longer current. Issue a fresh one.");
  }

  const shipment = quote.shipment;
  const reference = await nextInvoiceReference(shipment.id, shipment.reference);

  const lines = quote.charges
    .sort((a, b) => a.chargeType.sortOrder - b.chargeType.sortOrder)
    .map((c, index) => ({
      description: c.chargeType.label,
      payee: c.payee,
      amount: c.amount.toString(),
      chargeCode: c.chargeType.code,
      sortOrder: index,
    }));

  const invoice = await db.invoice.create({
    data: {
      reference,
      shipmentId: shipment.id,
      quoteId: quote.id,
      businessId: shipment.businessId,
      billToEmail: shipment.business?.billingEmail ?? shipment.owner.email,
      status: "ISSUED",
      governmentTotal: quote.governmentTotal,
      brokerTotal: quote.brokerTotal,
      total: cents(money(quote.governmentTotal).plus(money(quote.brokerTotal))).toFixed(2),
      issuedAt: new Date(),
      dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      lines: { create: lines },
    },
    include: { lines: true },
  });

  await recordAudit({
    actorId,
    action: "invoice.issued",
    entityType: "Invoice",
    entityId: invoice.id,
    newValue: {
      reference,
      governmentTotal: invoice.governmentTotal.toString(),
      brokerTotal: invoice.brokerTotal.toString(),
    },
  });

  return invoice;
}

export async function recordPayment(input: {
  invoiceId: string;
  amount: string;
  provider: string;
  providerRef?: string;
  actorId: string;
}) {
  const invoice = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) throw new DomainError("Invoice not found.", 404);
  if (invoice.status === "VOIDED") throw new DomainError("That invoice has been voided.");

  const amount = cents(input.amount);
  if (amount.lessThanOrEqualTo(0)) throw new DomainError("Enter a payment amount above zero.");

  const paid = cents(money(invoice.amountPaid).plus(amount));
  const total = money(invoice.total);
  const status = paid.greaterThanOrEqualTo(total)
    ? "PAID"
    : paid.greaterThan(0)
      ? "PARTIALLY_PAID"
      : invoice.status;

  const [payment] = await db.$transaction([
    db.payment.create({
      data: {
        invoiceId: invoice.id,
        provider: input.provider,
        providerRef: input.providerRef ?? null,
        amount: amount.toFixed(2),
        status: "SUCCEEDED",
        receivedAt: new Date(),
        recordedBy: input.actorId,
      },
    }),
    db.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: paid.toFixed(2), status },
    }),
  ]);

  await recordAudit({
    actorId: input.actorId,
    action: "payment.recorded",
    entityType: "Invoice",
    entityId: invoice.id,
    oldValue: { amountPaid: invoice.amountPaid.toString(), status: invoice.status },
    newValue: { amountPaid: paid.toFixed(2), status },
  });

  return payment;
}

/**
 * Revenue for a period. Deliberately the only function that produces a revenue
 * figure, and it reads brokerTotal exclusively.
 */
export async function revenueBetween(from: Date, to: Date) {
  const invoices = await db.invoice.findMany({
    where: { issuedAt: { gte: from, lte: to }, status: { notIn: ["DRAFT", "VOIDED"] } },
    select: { brokerTotal: true, governmentTotal: true, amountPaid: true, total: true },
  });

  const brokerRevenue = invoices.reduce((acc, i) => acc.plus(money(i.brokerTotal)), money(0));
  const governmentCollected = invoices.reduce((acc, i) => acc.plus(money(i.governmentTotal)), money(0));
  const outstanding = invoices.reduce(
    (acc, i) => acc.plus(money(i.total).minus(money(i.amountPaid))),
    money(0),
  );

  return {
    /** Kencole's income. */
    brokerRevenue: cents(brokerRevenue).toFixed(2),
    /** Held on behalf of the Public Treasury. A liability, reported separately. */
    governmentCollected: cents(governmentCollected).toFixed(2),
    outstanding: cents(outstanding).toFixed(2),
    invoiceCount: invoices.length,
  };
}
