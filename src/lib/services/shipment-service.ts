import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { cents, money } from "@/lib/money";
import {
  calculateLandedCost,
  summariseCharges,
  type ChargeLine,
  type LandedCostResult,
} from "@/lib/domain/landed-cost";
import { calculateBrokerCharges } from "@/lib/domain/pricing";
import { canTransition, type ShipmentStatus } from "@/lib/domain/shipment-state";
import { detectExceptions } from "@/lib/domain/exceptions";
import { readyForDeclaration } from "@/lib/domain/classification";
import { loadPricingRules, loadRateBook } from "./rate-book";
import { nextQuoteReference, nextShipmentReference } from "./references";
import type { ShipmentInput } from "@/lib/validation/schemas";
import { notify } from "@/lib/providers/notifications";

export class DomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "DomainError";
  }
}

export async function createShipment(input: {
  data: ShipmentInput;
  ownerId: string;
  businessId?: string | null;
}) {
  const { data, ownerId, businessId } = input;

  let supplierId: string | null = null;
  if (data.supplierName) {
    const supplier = await db.supplier.findFirst({
      where: { name: data.supplierName, businessId: businessId ?? null },
    });
    supplierId =
      supplier?.id ??
      (
        await db.supplier.create({
          data: {
            name: data.supplierName,
            country: data.supplierCountry || "US",
            businessId: businessId ?? null,
          },
        })
      ).id;
  }

  const shipment = await db.shipment.create({
    data: {
      reference: await nextShipmentReference(),
      ownerId,
      businessId: businessId ?? null,
      importType: data.importType,
      freightMode: data.freightMode,
      supplierId,
      trackingNumber: data.trackingNumber || null,
      airwayBill: data.airwayBill || null,
      originCountry: data.originCountry || null,
      description: data.description || null,
      currency: data.currency,
      goodsValue: data.goodsValue,
      freightCost: data.freightCost,
      insuranceCost: data.insuranceCost,
      status: "DRAFT",
      items: {
        create: data.items.map((item, index) => ({
          lineNumber: index + 1,
          description: item.description,
          quantity: item.quantity,
          unitValue: item.unitValue,
          lineValue: cents(money(item.quantity).times(money(item.unitValue))).toFixed(2),
          originCountry: item.originCountry || null,
        })),
      },
      history: { create: { to: "DRAFT", actorId: ownerId, note: "Shipment created" } },
    },
    include: { items: true },
  });

  await recordAudit({
    actorId: ownerId,
    action: "shipment.created",
    entityType: "Shipment",
    entityId: shipment.id,
    newValue: { reference: shipment.reference, goodsValue: data.goodsValue },
  });

  return shipment;
}

/**
 * Recalculate and store the estimate. Called on every material change so the
 * figure a customer is looking at always reflects the current data, and stamped
 * with the time so a stale estimate is visible as stale.
 */
export async function estimateShipment(shipmentId: string): Promise<LandedCostResult> {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      items: { include: { hsCode: true }, orderBy: { lineNumber: "asc" } },
      business: { include: { subscription: { include: { plan: true } } } },
      owner: { include: { consumerProfile: { include: { membership: { include: { plan: true } } } } } },
    },
  });
  if (!shipment) throw new DomainError("Shipment not found.", 404);

  const [rateBook, pricingRules] = await Promise.all([
    loadRateBook(),
    loadPricingRules(shipment.businessId),
  ]);

  // A business shipment is priced on the business's plan, a personal one on the
  // importer's own membership. A lapsed or cancelled subscription earns nothing.
  const subscription = shipment.businessId
    ? shipment.business?.subscription
    : shipment.owner.consumerProfile?.membership;
  const live =
    subscription?.status === "ACTIVE" && (!subscription.endsAt || subscription.endsAt > new Date());
  const plan = live ? subscription.plan : null;

  const customsValue = cents(
    money(shipment.goodsValue).plus(money(shipment.freightCost)).plus(money(shipment.insuranceCost)),
  );

  const brokerCharges = calculateBrokerCharges(pricingRules, {
    customsValue: customsValue.toString(),
    lineCount: Math.max(shipment.items.length, 1),
    importType: shipment.importType,
    businessId: shipment.businessId,
    planCode: plan?.code ?? null,
    brokerageDiscount: plan?.brokerageDiscount?.toString() ?? 0,
    deliveryDiscount: plan?.deliveryDiscount?.toString() ?? 0,
    deliveryRequested: true,
  });

  const result = calculateLandedCost(
    {
      goodsValue: shipment.goodsValue.toString(),
      freightCost: shipment.freightCost.toString(),
      insuranceCost: shipment.insuranceCost.toString(),
      grossWeightKg: shipment.grossWeightKg?.toString() ?? null,
      lines: shipment.items.map((i) => ({
        lineNumber: i.lineNumber,
        description: i.description,
        quantity: i.quantity.toString(),
        lineValue: i.lineValue.toString(),
        hsCode: i.hsCode?.code ?? null,
      })),
    },
    rateBook,
    brokerCharges,
  );

  await db.shipment.update({
    where: { id: shipmentId },
    // LandedCostResult is an interface, so it has no implicit index signature and
    // does not structurally satisfy InputJsonValue. It is plain JSON at runtime.
    data: { estimateJson: result as unknown as Prisma.InputJsonValue, estimatedAt: new Date() },
  });

  return result;
}

export async function refreshExceptions(shipmentId: string): Promise<void> {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      items: { include: { hsCode: { include: { permits: true } } } },
      documents: { where: { deletedAt: null } },
      history: { orderBy: { createdAt: "desc" }, take: 1 },
      declaration: true,
      quotes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!shipment) return;

  const duplicateTracking = shipment.trackingNumber
    ? (await db.shipment.count({
        where: { trackingNumber: shipment.trackingNumber, id: { not: shipment.id }, deletedAt: null },
      })) > 0
    : false;

  const flags = detectExceptions({
    hasCommercialInvoice: shipment.documents.some((d) => d.kind === "COMMERCIAL_INVOICE"),
    freightCost: shipment.freightCost.toString(),
    goodsValue: shipment.goodsValue.toString(),
    freightMode: shipment.freightMode,
    lines: shipment.items.map((i) => ({
      lineNumber: i.lineNumber,
      hsCode: i.hsCode?.code ?? null,
      lineValue: i.lineValue.toString(),
      regulated: (i.hsCode?.permits.length ?? 0) > 0,
    })),
    status: shipment.status,
    statusChangedAt: shipment.history[0]?.createdAt ?? shipment.createdAt,
    duplicateTrackingNumber: duplicateTracking,
    quotedGovernmentTotal: shipment.quotes[0]?.governmentTotal.toString() ?? null,
    assessedGovernmentTotal: shipment.declaration?.assessedTotal?.toString() ?? null,
  });

  // Replace the open set rather than appending, so a fixed problem disappears.
  await db.$transaction([
    db.exceptionFlag.deleteMany({ where: { shipmentId, resolvedAt: null } }),
    db.exceptionFlag.createMany({
      data: flags.map((f) => ({ shipmentId, code: f.code, severity: f.severity, message: f.message })),
    }),
  ]);
}

export async function transitionShipment(input: {
  shipmentId: string;
  to: ShipmentStatus;
  actorId: string;
  note?: string;
}) {
  const shipment = await db.shipment.findUnique({
    where: { id: input.shipmentId },
    include: {
      items: true,
      documents: { where: { deletedAt: null } },
      invoices: true,
      owner: { select: { email: true, phone: true, id: true } },
    },
  });
  if (!shipment) throw new DomainError("Shipment not found.", 404);

  const invoiceSettled = shipment.invoices.some(
    (i) =>
      i.status !== "VOIDED" && i.status !== "REFUNDED" &&
      (i.status === "PAID" || money(i.amountPaid).greaterThanOrEqualTo(money(i.total))),
  );

  const verdict = canTransition(shipment.status, input.to, {
    brokerApproved: readyForDeclaration(shipment.items.map((i) => i.classificationStatus)),
    invoiceSettled,
    hasRequiredDocuments: shipment.documents.some((d) => d.kind === "COMMERCIAL_INVOICE"),
  });
  if (!verdict.ok) throw new DomainError(verdict.reason ?? "That status change is not allowed.");

  const { updated, voided } = await db.$transaction(async (tx) => {
    // Conditional on the status the guards were checked against, so two
    // concurrent changes cannot both apply from the same starting point.
    const moved = await tx.shipment.updateMany({
      where: { id: shipment.id, status: shipment.status },
      data: { status: input.to },
    });
    if (moved.count === 0) {
      throw new DomainError("The shipment changed while you were working on it. Reload and try again.", 409);
    }
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id,
        from: shipment.status,
        to: input.to,
        actorId: input.actorId,
        note: input.note ?? null,
      },
    });

    // A cancelled shipment will never be paid for, so its unpaid invoices stop
    // counting as revenue or as money owed. Any invoice with money against it is
    // left alone: that needs a refund, not a void.
    const toVoid =
      input.to === "CANCELLED"
        ? await tx.invoice.findMany({
            where: { shipmentId: shipment.id, status: { in: ["DRAFT", "ISSUED", "OVERDUE"] }, amountPaid: 0 },
            select: { id: true, reference: true, status: true },
          })
        : [];
    if (toVoid.length) {
      await tx.invoice.updateMany({
        where: { id: { in: toVoid.map((v) => v.id) } },
        data: { status: "VOIDED" },
      });
    }

    return {
      updated: await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } }),
      voided: toVoid,
    };
  });

  await recordAudit({
    actorId: input.actorId,
    action: "shipment.status_changed",
    entityType: "Shipment",
    entityId: shipment.id,
    oldValue: { status: shipment.status },
    newValue: { status: input.to },
  });
  for (const v of voided) {
    await recordAudit({
      actorId: input.actorId,
      action: "invoice.voided",
      entityType: "Invoice",
      entityId: v.id,
      oldValue: { reference: v.reference, status: v.status },
      newValue: { status: "VOIDED" },
      reason: `Shipment ${shipment.reference} cancelled`,
    });
  }

  await notifyOnStatus(shipment.owner, shipment.reference, input.to);
  await refreshExceptions(shipment.id);

  return updated;
}

const STATUS_NOTIFICATIONS: Partial<
  Record<ShipmentStatus, { event: Parameters<typeof notify>[0]["event"]; subject: string; body: string }>
> = {
  DOCUMENTS_REQUIRED: {
    event: "documents.missing",
    subject: "We need a document for your shipment",
    body: "We can't start your entry until the commercial invoice is uploaded.",
  },
  QUOTE_READY: {
    event: "quote.ready",
    subject: "Your import estimate is ready",
    body: "Open your shipment to see the estimated duty, VAT and our fees.",
  },
  AWAITING_PAYMENT: {
    event: "payment.required",
    subject: "Payment needed to continue",
    body: "Your shipment moves as soon as the invoice is settled.",
  },
  CUSTOMS_HOLD: {
    event: "customs.hold",
    subject: "Your shipment is held by Bahamas Customs",
    body: "We're working on it and will tell you as soon as anything changes.",
  },
  CUSTOMS_RELEASED: {
    event: "customs.released",
    subject: "Released by customs",
    body: "Your shipment has cleared and is being prepared for delivery.",
  },
  DELIVERED: {
    event: "delivery.completed",
    subject: "Delivered",
    body: "Thanks for importing with Kencole.",
  },
};

async function notifyOnStatus(
  owner: { id: string; email: string; phone: string | null },
  reference: string,
  status: ShipmentStatus,
) {
  const template = STATUS_NOTIFICATIONS[status];
  if (!template) return;
  await notify({
    userId: owner.id,
    email: owner.email,
    phone: owner.phone,
    event: template.event,
    subject: `${reference}: ${template.subject}`,
    body: template.body,
  }).catch((e) => console.error("notification failed", e));
}

/**
 * Turn the current estimate into a quote. The quote records whether a broker had
 * approved the classifications at the moment it was issued, so an unapproved
 * quote can never be mistaken later for a reviewed one.
 */
export async function issueQuote(shipmentId: string, actorId: string) {
  const estimate = await estimateShipment(shipmentId);

  const summary = summariseCharges(estimate.charges);
  const chargeTypes = await db.chargeType.findMany({
    where: { code: { in: summary.map((c) => c.chargeCode) } },
  });
  const typeByCode = new Map(chargeTypes.map((t) => [t.code, t]));

  const { quote, shipment } = await db.$transaction(async (tx) => {
    // Quoting one shipment is serialised. Without the lock, two concurrent calls
    // each supersede only the quotes they can see, and both leave an ISSUED quote.
    await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE`;
    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { items: true },
    });
    if (shipment.status === "CANCELLED") {
      throw new DomainError("That shipment has been cancelled.");
    }

    await tx.quote.updateMany({
      where: { shipmentId, status: { in: ["DRAFT", "ISSUED"] } },
      data: { status: "SUPERSEDED" },
    });

    const reference = await nextQuoteReference(shipmentId, shipment.reference, tx);
    const created = await tx.quote.create({
      data: {
        reference,
        shipmentId,
        status: "ISSUED",
        customsValue: estimate.customsValue,
        governmentTotal: estimate.governmentTotal,
        brokerTotal: estimate.brokerTotal,
        grandTotal: estimate.grandTotal,
        brokerApproved: readyForDeclaration(shipment.items.map((i) => i.classificationStatus)),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      },
    });

    await tx.customsCharge.createMany({
      data: summary
        .filter((c) => typeByCode.has(c.chargeCode))
        .map((c) => ({
          quoteId: created.id,
          chargeTypeId: typeByCode.get(c.chargeCode)!.id,
          payee: c.payee,
          basisAmount: c.basisAmount,
          rateApplied: c.rateApplied,
          amount: c.amount,
          rateRuleId: c.rateRuleId ?? null,
        })),
    });

    return { quote: created, shipment };
  });

  await recordAudit({
    actorId,
    action: "quote.issued",
    entityType: "Quote",
    entityId: quote.id,
    newValue: {
      shipment: shipment.reference,
      governmentTotal: estimate.governmentTotal,
      brokerTotal: estimate.brokerTotal,
    },
  });

  return quote;
}
