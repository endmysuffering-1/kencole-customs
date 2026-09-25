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
import { DomainError } from "./errors";
import {
  SUPPORTED_CURRENCIES,
  type ShipmentInput,
  type shipmentUpdateSchema,
  type estimateSchema,
} from "@/lib/validation/schemas";
import type { z } from "zod";
import { can, canAccessResource, type Capability, type Principal } from "@/lib/auth/rbac";
import { invoiceQuote } from "./invoice-service";
import { shipmentScope } from "./shipment-queries";
import { notify, type NotificationEvent } from "@/lib/providers/notifications";
import type { EmailContent } from "@/lib/email-layout";

export async function createShipment(input: {
  data: ShipmentInput;
  ownerId: string;
  businessId?: string | null;
}) {
  const { data, ownerId, businessId } = input;
  assertSupportedCurrency(data.currency);

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
      heldAt: data.heldAt,
      deliveryRequested: data.deliveryRequested,
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
    // Delivery is only quoted to a customer who asked for it; the rest collect.
    deliveryRequested: shipment.deliveryRequested,
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
      owner: { select: { email: true, phone: true, id: true, fullName: true } },
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

  await notifyOnStatus(shipment, input.to);
  await refreshExceptions(shipment.id);

  return updated;
}

interface NotifiedShipment {
  id: string;
  reference: string;
  description: string | null;
  heldAt: string | null;
  deliveryRequested: boolean;
  owner: { id: string; email: string; phone: string | null; fullName: string };
}

type StatusMessage = { event: NotificationEvent; subject: string; content: Omit<EmailContent, "greetingName"> };

/**
 * What the customer is told when their shipment moves. Each message says what
 * happened, what happens next, and links to the shipment. Statuses not listed
 * here are internal steps and send nothing.
 */
function statusMessage(s: NotifiedShipment, status: ShipmentStatus): StatusMessage | null {
  const goods = s.description?.trim() || "your shipment";
  const open = (label: string) => ({ label, path: `/shipments/${s.id}` });
  switch (status) {
    case "DOCUMENTS_REQUIRED":
      return {
        event: "documents.missing",
        subject: "We need a document",
        content: {
          heading: "We need the seller's invoice",
          paragraphs: [
            `We can't start clearing ${goods} (${s.reference}) until the commercial invoice is uploaded.`,
            "A PDF or a clear photo of it is fine.",
          ],
          action: open("Upload the invoice"),
        },
      };
    case "QUOTE_READY":
      return {
        event: "quote.ready",
        subject: "Your quote is ready",
        content: {
          heading: `Your quote for ${goods} is ready`,
          paragraphs: [
            "It shows the government's duty, VAT and levies and our fees, each listed separately.",
            "Accept it to continue. Nothing is charged until you do.",
          ],
          action: open("See your quote"),
        },
      };
    case "AWAITING_PAYMENT":
      return {
        event: "payment.required",
        subject: "Payment needed to continue",
        content: {
          heading: "Your invoice is ready to pay",
          paragraphs: [`We'll prepare the customs entry for ${goods} as soon as it's settled. Your shipment page has the invoice and how to pay.`],
          action: open("View the invoice"),
        },
      };
    case "PAID":
      return {
        event: "payment.received",
        subject: "Payment received",
        content: {
          heading: "Payment received, thank you",
          paragraphs: [`We're preparing the customs entry for ${goods} now, and we'll tell you when Bahamas Customs releases it.`],
          action: open("Track your shipment"),
        },
      };
    case "CUSTOMS_HOLD":
      return {
        event: "customs.hold",
        subject: "Held by Bahamas Customs",
        content: {
          heading: "Bahamas Customs is holding your shipment",
          paragraphs: ["We're working on it and will tell you as soon as anything changes. If we need something from you, it will show on your shipment page."],
          action: open("Open your shipment"),
        },
      };
    case "CUSTOMS_RELEASED":
      return {
        event: "customs.released",
        subject: "Released by customs",
        content: {
          heading: `${goods.charAt(0).toUpperCase()}${goods.slice(1)} has cleared customs`,
          paragraphs: s.deliveryRequested
            ? ["Bahamas Customs has released it. We'll be in touch to arrange delivery."]
            : [`Bahamas Customs has released it, so it's ready to collect${s.heldAt ? ` from ${s.heldAt}` : ""}. Quote your reference, ${s.reference}.`],
          action: open("Open your shipment"),
        },
      };
    case "DELIVERED":
      return {
        event: "delivery.completed",
        subject: s.deliveryRequested ? "Delivered" : "Collected",
        content: {
          heading: s.deliveryRequested ? "Your goods have been delivered" : "Your goods have been collected",
          paragraphs: ["Thanks for clearing with Kencole. Your invoice and documents stay on your shipment page."],
          action: open("Open your shipment"),
        },
      };
    default:
      return null;
  }
}

async function notifyOnStatus(shipment: NotifiedShipment, status: ShipmentStatus) {
  const message = statusMessage(shipment, status);
  if (!message) return;
  await notify({
    userId: shipment.owner.id,
    email: shipment.owner.email,
    phone: shipment.owner.phone,
    event: message.event,
    subject: `${shipment.reference}: ${message.subject}`,
    content: { ...message.content, greetingName: shipment.owner.fullName },
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

// ─── Acting on shipments for a person ─────────────────────────────────────────

type ShipmentUpdate = z.infer<typeof shipmentUpdateSchema>;
type EstimateInput = z.infer<typeof estimateSchema>;

export function assertSupportedCurrency(currency: string | undefined) {
  if (currency && !(SUPPORTED_CURRENCIES as readonly string[]).includes(currency.toUpperCase())) {
    throw new DomainError(
      `We can only cost shipments in ${SUPPORTED_CURRENCIES.join(" or ")} for now. Convert the invoice values and try again.`,
    );
  }
}

/** Statuses in which the customer still owns the paperwork and may change it. */
const OWNER_EDITABLE: ShipmentStatus[] = ["DRAFT", "DOCUMENTS_REQUIRED", "DOCUMENTS_RECEIVED"];
const FINAL: ShipmentStatus[] = ["DELIVERED", "CANCELLED"];

/**
 * Opens a shipment for a person. A business shipment is only opened for a member
 * of that business; with no business named, a member of exactly one business
 * files under it, and anyone else files personally.
 */
export async function openShipment(input: {
  principal: Principal;
  data: ShipmentInput & { businessId?: string };
}) {
  const { principal, data } = input;
  let businessId = data.businessId ?? null;
  if (businessId && !principal.businessIds.includes(businessId)) {
    throw new DomainError("You can only file shipments for a business you belong to.", 403);
  }
  if (!businessId && principal.businessIds.length === 1 && principal.role !== "CONSUMER") {
    businessId = principal.businessIds[0]!;
  }

  const shipment = await createShipment({
    ownerId: principal.id,
    businessId,
    data: { ...data, importType: businessId ? "COMMERCIAL" : data.importType },
  });
  await estimateShipment(shipment.id);
  await refreshExceptions(shipment.id);
  return shipment;
}

/**
 * Changes a shipment's details. The customer may change their own shipment until
 * review starts; after that only staff may, and a change to any value or line
 * needs a reason, re-opens classification, and withdraws the quotes that were
 * priced on the old figures.
 */
export async function updateShipment(input: { principal: Principal; shipmentId: string; data: ShipmentUpdate }) {
  const { principal, shipmentId, data } = input;
  const found = await db.shipment.findFirst({ where: { AND: [shipmentScope(principal), { id: shipmentId }] } });
  if (!found || !canAccessResource(principal, found, "write")) throw new DomainError("Shipment not found.", 404);

  const staff = can(principal.role, "shipment:edit:any");
  if (FINAL.includes(found.status)) throw new DomainError("A finished shipment can't be changed.", 409);
  if (!staff && !OWNER_EDITABLE.includes(found.status)) {
    throw new DomainError("We've started working on this shipment. Contact us to change it.", 409);
  }
  assertSupportedCurrency(data.currency);

  // Asking for delivery, or dropping it, changes the fee quoted, so it counts as a value.
  const valueFields = ["goodsValue", "freightCost", "insuranceCost", "currency", "deliveryRequested"] as const;
  const valueChanged =
    data.items !== undefined ||
    valueFields.some((f) => data[f] !== undefined && String(data[f]) !== String(found[f]));
  const pastIntake = !OWNER_EDITABLE.includes(found.status);
  const reason = data.reason?.trim();
  if (valueChanged && pastIntake && !reason) {
    throw new DomainError("Give a reason for changing values on a shipment that is already under way.");
  }

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE`;
    const current = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (current.status !== found.status) {
      throw new DomainError("The shipment changed while you were working on it. Reload and try again.", 409);
    }

    let supplierId = current.supplierId;
    if (data.supplierName) {
      const existing = await tx.supplier.findFirst({ where: { name: data.supplierName, businessId: current.businessId } });
      supplierId = existing?.id ?? (
        await tx.supplier.create({
          data: { name: data.supplierName, country: data.supplierCountry || "US", businessId: current.businessId },
        })
      ).id;
    }

    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        supplierId,
        freightMode: data.freightMode,
        trackingNumber: data.trackingNumber,
        airwayBill: data.airwayBill,
        heldAt: data.heldAt,
        deliveryRequested: data.deliveryRequested,
        originCountry: data.originCountry,
        description: data.description,
        currency: data.currency?.toUpperCase(),
        goodsValue: data.goodsValue,
        freightCost: data.freightCost,
        insuranceCost: data.insuranceCost,
      },
    });

    if (data.items) {
      await tx.shipmentItem.deleteMany({ where: { shipmentId } });
      await tx.shipmentItem.createMany({
        data: data.items.map((item, index) => ({
          shipmentId,
          lineNumber: index + 1,
          description: item.description,
          quantity: item.quantity,
          unitValue: item.unitValue,
          lineValue: cents(money(item.quantity).times(money(item.unitValue))).toFixed(2),
          originCountry: item.originCountry || null,
        })),
      });
    }

    // A quote priced on the old figures must not be accepted or invoiced.
    if (valueChanged) {
      await tx.quote.updateMany({
        where: { shipmentId, status: { in: ["DRAFT", "ISSUED"] } },
        data: { status: "SUPERSEDED" },
      });
    }

    const changed = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => k !== "reason" && k !== "items" && v !== undefined),
    );
    await recordAudit(
      {
        actorId: principal.id,
        action: valueChanged && pastIntake ? "shipment.value_changed" : "shipment.updated",
        entityType: "Shipment",
        entityId: shipmentId,
        oldValue: Object.fromEntries(Object.keys(changed).map((k) => [k, String(current[k as keyof typeof current] ?? "")])),
        newValue: { ...changed, ...(data.items ? { lines: data.items.length } : {}) },
        reason,
      },
      tx,
    );
  });

  await estimateShipment(shipmentId);
  await refreshExceptions(shipmentId);
  return db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
}

/** Status changes that need more than shipment:transition. */
export const STATUS_CAPABILITY: Partial<Record<ShipmentStatus, Capability>> = {
  DECLARATION_PREPARED: "declaration:prepare",
  SUBMITTED_TO_CUSTOMS: "declaration:submit",
};

/**
 * A status change requested by a person. Staff move shipments through the
 * workflow; submitting to customs additionally needs the broker's licence. A
 * customer's only move is to withdraw their own shipment before review starts.
 */
export async function requestTransition(input: {
  principal: Principal;
  shipmentId: string;
  to: ShipmentStatus;
  note?: string;
}) {
  const { principal, shipmentId, to } = input;
  const shipment = await db.shipment.findFirst({
    where: { AND: [shipmentScope(principal), { id: shipmentId }] },
    select: { id: true, status: true, ownerId: true, businessId: true },
  });
  if (!shipment) throw new DomainError("Shipment not found.", 404);

  if (can(principal.role, "shipment:transition")) {
    const needed = STATUS_CAPABILITY[to];
    if (needed && !can(principal.role, needed)) {
      throw new DomainError(
        to === "SUBMITTED_TO_CUSTOMS"
          ? "Only a licensed customs broker can submit an entry."
          : "Your account can't make that change.",
        403,
      );
    }
  } else {
    const withdrawal = to === "CANCELLED" && OWNER_EDITABLE.includes(shipment.status);
    if (!withdrawal || !canAccessResource(principal, shipment, "write")) {
      throw new DomainError("You can't make that change to this shipment.", 403);
    }
  }

  return transitionShipment({ shipmentId, to, actorId: principal.id, note: input.note });
}

/**
 * The customer accepts a quote. Accepting, moving the shipment to
 * AWAITING_PAYMENT and raising the invoice happen in one transaction: a customer
 * never ends up with an accepted quote and no invoice, or an invoice for a quote
 * that was never accepted.
 *
 * Only a quote a licensed broker has stood behind can be accepted. An estimate
 * issued before classification was approved could change, and the customer
 * would be paying against a number nobody has checked.
 */
export async function acceptQuote(input: { principal: Principal; quoteId: string }) {
  const { principal, quoteId } = input;
  const found = await db.quote.findUnique({ where: { id: quoteId }, select: { shipmentId: true } });
  const shipment = found
    ? await db.shipment.findFirst({
        where: { AND: [shipmentScope(principal), { id: found.shipmentId }] },
        include: { owner: { select: { id: true, email: true, phone: true, fullName: true } } },
      })
    : null;
  if (!found || !shipment || !canAccessResource(principal, shipment, "write")) {
    throw new DomainError("Quote not found.", 404);
  }

  const invoice = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${shipment.id} FOR UPDATE`;
    const current = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });

    if (quote.status !== "ISSUED") throw new DomainError("That quote can no longer be accepted.", 409);
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new DomainError("That quote has expired. Ask us for a fresh one.", 409);
    }
    if (!quote.brokerApproved) {
      throw new DomainError("A licensed broker hasn't reviewed this estimate yet, so it can't be accepted.", 409);
    }
    const verdict = canTransition(current.status, "AWAITING_PAYMENT", {
      brokerApproved: true, invoiceSettled: false, hasRequiredDocuments: true,
    });
    if (current.status !== "QUOTE_READY" || !verdict.ok) {
      throw new DomainError("This shipment isn't waiting on a quote.", 409);
    }

    await tx.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED" } });
    await tx.shipment.update({ where: { id: shipment.id }, data: { status: "AWAITING_PAYMENT" } });
    await tx.shipmentStatusHistory.create({
      data: {
        shipmentId: shipment.id, from: current.status, to: "AWAITING_PAYMENT",
        actorId: principal.id, note: `Quote ${quote.reference} accepted`,
      },
    });
    await recordAudit(
      { actorId: principal.id, action: "quote.accepted", entityType: "Quote", entityId: quoteId, newValue: { reference: quote.reference } },
      tx,
    );
    return invoiceQuote(tx, quoteId, principal.id);
  });

  await notifyOnStatus(shipment, "AWAITING_PAYMENT");
  await refreshExceptions(shipment.id);
  return invoice;
}

/**
 * The public calculator: one line, list prices, no account. Always an estimate,
 * and every charge from an unconfirmed rate comes back flagged.
 */
export async function quickEstimate(input: EstimateInput) {
  assertSupportedCurrency(input.currency);
  const hs = input.hsCode
    ? await db.hsCode.findUnique({ where: { code: input.hsCode }, include: { permits: true } })
    : null;

  const [rateBook, pricingRules] = await Promise.all([loadRateBook(), loadPricingRules(null)]);
  const customsValue = cents(money(input.goodsValue).plus(money(input.freightCost)).plus(money(input.insuranceCost)));
  const brokerCharges = calculateBrokerCharges(
    pricingRules.filter((r) => r.scope === "GLOBAL"),
    {
      customsValue: customsValue.toString(),
      lineCount: 1,
      importType: input.importType,
      deliveryRequested: input.deliveryRequested,
      rush: input.rush,
    },
  );
  const result = calculateLandedCost(
    {
      goodsValue: input.goodsValue,
      freightCost: input.freightCost,
      insuranceCost: input.insuranceCost,
      lines: [{
        lineNumber: 1, description: "Goods", quantity: 1, lineValue: input.goodsValue,
        hsCode: hs?.active ? hs.code : null,
      }],
    },
    rateBook,
    brokerCharges,
  );

  return {
    ...result,
    charges: summariseCharges(result.charges),
    hsCode: hs ? { code: hs.code, description: hs.description } : null,
    hsCodeRecognised: !input.hsCode || Boolean(hs?.active),
    permits: (hs?.permits ?? []).map((p) => ({ agency: p.agency, permit: p.permit, notes: p.notes })),
  };
}
