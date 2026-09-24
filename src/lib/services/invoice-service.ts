import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { cents, money } from "@/lib/money";
import { DomainError } from "./errors";
import { nextInvoiceReference } from "./references";
import { invoiceScope } from "./shipment-queries";
import { payments } from "@/lib/providers/payments";
import type { Principal } from "@/lib/auth/rbac";

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
  return db.$transaction((tx) => invoiceQuote(tx, quoteId, actorId));
}

/**
 * Raises the invoice for a quote inside the caller's transaction, so a flow that
 * also moves the shipment (accepting a quote) commits both or neither.
 */
export async function invoiceQuote(tx: Prisma.TransactionClient, quoteId: string, actorId: string) {
  // One live invoice per quote. The row lock makes a double-submit wait here,
  // then find the first request's invoice and be refused, instead of both
  // requests billing the customer.
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR UPDATE`;

  const quote = await tx.quote.findUnique({
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
  if (quote.shipment.status === "CANCELLED") {
    throw new DomainError("That shipment has been cancelled.");
  }

  const existing = await tx.invoice.findFirst({
    where: { quoteId, status: { not: "VOIDED" } },
    select: { reference: true },
  });
  if (existing) {
    throw new DomainError(`This quote has already been invoiced as ${existing.reference}.`, 409);
  }

  const shipment = quote.shipment;
  const reference = await nextInvoiceReference(shipment.id, shipment.reference, tx);

  const lines = quote.charges
    .sort((a, b) => a.chargeType.sortOrder - b.chargeType.sortOrder)
    .map((c, index) => ({
      description: c.chargeType.label,
      payee: c.payee,
      amount: c.amount.toString(),
      chargeCode: c.chargeType.code,
      sortOrder: index,
    }));

  const invoice = await tx.invoice.create({
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

  await recordAudit(
    {
      actorId,
      action: "invoice.issued",
      entityType: "Invoice",
      entityId: invoice.id,
      newValue: {
        reference,
        governmentTotal: invoice.governmentTotal.toString(),
        brokerTotal: invoice.brokerTotal.toString(),
      },
    },
    tx,
  );

  return invoice;
}

export async function recordPayment(input: {
  invoiceId: string;
  amount: string;
  provider: string;
  providerRef?: string;
  actorId: string;
}) {
  const amount = cents(input.amount);
  if (amount.lessThanOrEqualTo(0)) throw new DomainError("Enter a payment amount above zero.");

  const { payment, before, after } = await db.$transaction(async (tx) => {
    // Payments against one invoice apply one after another. Without the lock two
    // concurrent payments both read the same amountPaid and the second write
    // discards the first, leaving a fully paid invoice marked PARTIALLY_PAID.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;

    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) throw new DomainError("Invoice not found.", 404);
    if (invoice.status === "VOIDED") throw new DomainError("That invoice has been voided.");

    const paid = cents(money(invoice.amountPaid).plus(amount));
    const status = paid.greaterThanOrEqualTo(money(invoice.total))
      ? ("PAID" as const)
      : ("PARTIALLY_PAID" as const);

    const created = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        provider: input.provider,
        providerRef: input.providerRef ?? null,
        amount: amount.toFixed(2),
        status: "SUCCEEDED",
        receivedAt: new Date(),
        recordedBy: input.actorId,
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: paid.toFixed(2), status },
    });

    return {
      payment: created,
      before: { amountPaid: invoice.amountPaid.toString(), status: invoice.status },
      after: { amountPaid: paid.toFixed(2), status },
    };
  });

  await recordAudit({
    actorId: input.actorId,
    action: "payment.recorded",
    entityType: "Invoice",
    entityId: input.invoiceId,
    oldValue: before,
    newValue: after,
  });

  return payment;
}

/**
 * Revenue for a period. Deliberately the only function that produces a revenue
 * figure, and it reads brokerTotal exclusively. Draft, voided and refunded
 * invoices are excluded: none of them represents fees Kencole has kept.
 */
export async function revenueBetween(from: Date, to: Date) {
  const invoices = await db.invoice.findMany({
    where: { issuedAt: { gte: from, lte: to }, status: { notIn: ["DRAFT", "VOIDED", "REFUNDED"] } },
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

/**
 * How to pay an invoice. Card processing is not wired up, so today this is bank
 * transfer instructions quoting the invoice reference; staff record the payment
 * when it arrives.
 */
export async function paymentInstructions(principal: Principal, invoiceId: string) {
  const invoice = await db.invoice.findFirst({ where: { AND: [invoiceScope(principal), { id: invoiceId }] } });
  if (!invoice) throw new DomainError("Invoice not found.", 404);
  if (["PAID", "VOIDED", "REFUNDED"].includes(invoice.status)) {
    throw new DomainError("Nothing is owed on that invoice.", 409);
  }
  const outstanding = cents(money(invoice.total).minus(money(invoice.amountPaid))).toFixed(2);
  const intent = await payments.createIntent({
    invoiceId: invoice.reference, amount: outstanding, currency: "BSD",
    method: "bank_transfer", customerEmail: invoice.billToEmail,
  });
  return { reference: invoice.reference, outstanding, currency: "BSD", method: "bank_transfer", instructions: intent.instructions };
}
