import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, isStaff, type Principal } from "@/lib/auth/rbac";
import {
  CUSTOMER_ACTION_STATUSES,
  customerLabel,
  customerMilestones,
  label,
  milestoneState,
  type ShipmentStatus,
} from "@/lib/domain/shipment-state";
import { DomainError } from "./errors";

/**
 * Reading shipments and invoices on someone's behalf.
 *
 * Every list and every single-record read for a person goes through a scope
 * built here, so a record outside it is simply never found. A record someone
 * cannot see answers 404, not 403: the response does not confirm it exists.
 */

export function shipmentScope(p: Principal): Prisma.ShipmentWhereInput {
  if (can(p.role, "shipment:read:any")) return { deletedAt: null };
  const own: Prisma.ShipmentWhereInput[] = [{ ownerId: p.id }];
  if (p.businessIds.length) own.push({ businessId: { in: p.businessIds } });
  return { deletedAt: null, OR: own };
}

export function invoiceScope(p: Principal): Prisma.InvoiceWhereInput {
  if (can(p.role, "shipment:read:any")) return {};
  const own: Prisma.InvoiceWhereInput[] = [{ shipment: { ownerId: p.id } }];
  if (p.businessIds.length) own.push({ businessId: { in: p.businessIds } });
  return { OR: own };
}

/** Status wording for whoever is looking. A customer never sees an internal name. */
export function statusLabel(status: ShipmentStatus, viewer: Principal, deliveryRequested = true): string {
  return isStaff(viewer.role) ? label(status) : customerLabel(status, deliveryRequested);
}

export async function listShipments(
  p: Principal,
  opts: { status?: ShipmentStatus; q?: string; take?: number; cursor?: string } = {},
) {
  const take = Math.min(opts.take ?? 50, 100);
  const filters: Prisma.ShipmentWhereInput[] = [shipmentScope(p)];
  if (opts.status) filters.push({ status: opts.status });
  if (opts.q) {
    filters.push({
      OR: [
        { reference: { contains: opts.q, mode: "insensitive" } },
        { description: { contains: opts.q, mode: "insensitive" } },
        { trackingNumber: { contains: opts.q, mode: "insensitive" } },
      ],
    });
  }
  const rows = await db.shipment.findMany({
    where: { AND: filters },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, reference: true, status: true, description: true, importType: true, freightMode: true,
      goodsValue: true, currency: true, createdAt: true, updatedAt: true, heldAt: true, deliveryRequested: true,
      business: { select: { id: true, legalName: true, tradingName: true } },
      items: { orderBy: { lineNumber: "asc" }, take: 1, select: { description: true } },
      invoices: {
        where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "PAID"] } },
        orderBy: { createdAt: "desc" }, take: 1,
        select: { id: true, reference: true, status: true, total: true, amountPaid: true },
      },
      _count: { select: { items: true } },
    },
  });
  const page = rows.slice(0, take);
  return {
    shipments: page.map((s) => ({ ...s, statusLabel: statusLabel(s.status, p, s.deliveryRequested) })),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
  };
}

/**
 * A shipment reference typed into search, resolved within what the person may
 * see. Anything outside their scope is simply not found.
 */
export async function findShipmentByReference(p: Principal, reference: string) {
  return db.shipment.findFirst({
    where: { AND: [shipmentScope(p), { reference: { equals: reference.trim(), mode: "insensitive" } }] },
    select: { id: true },
  });
}

const detailInclude = {
  items: { include: { hsCode: true }, orderBy: { lineNumber: "asc" } },
  documents: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
  history: { orderBy: { createdAt: "asc" } },
  quotes: { include: { charges: { include: { chargeType: true } } }, orderBy: { createdAt: "asc" } },
  invoices: { orderBy: { createdAt: "asc" } },
  declaration: true,
  delivery: true,
  exceptions: { where: { resolvedAt: null }, orderBy: { createdAt: "asc" } },
  supplier: true,
  business: { select: { id: true, legalName: true, tradingName: true } },
  owner: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.ShipmentInclude;

type ShipmentDetail = Prisma.ShipmentGetPayload<{ include: typeof detailInclude }>;

export async function getShipment(p: Principal, id: string) {
  const shipment = await db.shipment.findFirst({ where: { AND: [shipmentScope(p), { id }] }, include: detailInclude });
  if (!shipment) throw new DomainError("Shipment not found.", 404);

  // Quote lines keep the rate rule they were priced from; whether that rule is
  // confirmed decides whether the charge is shown as unverified.
  const ruleIds = shipment.quotes.flatMap((q) =>
    q.charges.filter((c) => c.payee === "GOVERNMENT" && c.rateRuleId).map((c) => c.rateRuleId!),
  );
  const rules = ruleIds.length
    ? await db.rateRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, confirmed: true } })
    : [];
  const confirmed = new Map(rules.map((r) => [r.id, r.confirmed]));

  return shipmentView(shipment, p, confirmed);
}

function shipmentView(s: ShipmentDetail, p: Principal, ruleConfirmed: Map<string, boolean>) {
  const staff = isStaff(p.role);
  return {
    id: s.id,
    reference: s.reference,
    status: s.status,
    statusLabel: statusLabel(s.status, p, s.deliveryRequested),
    milestones: customerMilestones(s.deliveryRequested).map((m) => ({ key: m.key, label: m.label, state: milestoneState(s.status, m.statuses) })),
    heldAt: s.heldAt,
    deliveryRequested: s.deliveryRequested,
    importType: s.importType,
    freightMode: s.freightMode,
    description: s.description,
    trackingNumber: s.trackingNumber,
    airwayBill: s.airwayBill,
    originCountry: s.originCountry,
    currency: s.currency,
    goodsValue: s.goodsValue,
    freightCost: s.freightCost,
    insuranceCost: s.insuranceCost,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    owner: staff ? s.owner : undefined,
    supplier: s.supplier ? { name: s.supplier.name, country: s.supplier.country } : null,
    business: s.business ? { id: s.business.id, name: s.business.tradingName ?? s.business.legalName } : null,
    estimate: s.estimateJson,
    estimatedAt: s.estimatedAt,
    items: s.items.map((i) => {
      const approved = i.classificationStatus === "BROKER_APPROVED";
      return {
        id: i.id,
        lineNumber: i.lineNumber,
        description: i.description,
        quantity: i.quantity,
        unitValue: i.unitValue,
        lineValue: i.lineValue,
        originCountry: i.originCountry,
        // A customer sees a tariff code only once a licensed broker has stood
        // behind it; a machine suggestion is staff-only working.
        hsCode: approved || staff ? (i.hsCode?.code ?? null) : null,
        hsDescription: approved || staff ? (i.hsCode?.description ?? null) : null,
        classified: approved,
        ...(staff
          ? {
              classificationStatus: i.classificationStatus,
              suggestedHsCode: i.suggestedHsCode,
              confidence: i.confidence,
              brokerNote: i.brokerNote,
            }
          : {}),
      };
    }),
    documents: s.documents.map((d) => ({
      id: d.id, kind: d.kind, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
      scanStatus: d.scanStatus, createdAt: d.createdAt,
    })),
    quotes: s.quotes
      .filter((q) => staff || q.status !== "SUPERSEDED")
      .map((q) => ({
        id: q.id,
        reference: q.reference,
        status: q.status,
        customsValue: q.customsValue,
        governmentTotal: q.governmentTotal,
        brokerTotal: q.brokerTotal,
        grandTotal: q.grandTotal,
        brokerApproved: q.brokerApproved,
        expiresAt: q.expiresAt,
        createdAt: q.createdAt,
        charges: q.charges
          .sort((a, b) => a.chargeType.sortOrder - b.chargeType.sortOrder)
          .map((c) => ({
            code: c.chargeType.code,
            label: c.chargeType.label,
            payee: c.payee,
            basisAmount: c.basisAmount,
            rateApplied: c.rateApplied,
            amount: c.amount,
            // No rule, or an unconfirmed one, is unverified. Kencole's own fees
            // are set by Kencole and are not a statement about the law.
            unverified: c.payee === "GOVERNMENT" && !(c.rateRuleId && ruleConfirmed.get(c.rateRuleId)),
          })),
      })),
    invoices: s.invoices.map((i) => ({
      id: i.id, reference: i.reference, status: i.status,
      governmentTotal: i.governmentTotal, brokerTotal: i.brokerTotal, total: i.total, amountPaid: i.amountPaid,
      issuedAt: i.issuedAt, dueAt: i.dueAt,
    })),
    history: s.history.map((h) =>
      staff
        ? { from: h.from, to: h.to, label: label(h.to), actorId: h.actorId, note: h.note, at: h.createdAt }
        : { to: h.to, label: customerLabel(h.to, s.deliveryRequested), at: h.createdAt },
    ),
    declaration: s.declaration
      ? staff
        ? s.declaration
        : { status: s.declaration.status, entryNumber: s.declaration.entryNumber, releasedAt: s.declaration.releasedAt }
      : null,
    delivery: s.delivery
      ? { status: s.delivery.status, scheduledFor: s.delivery.scheduledFor, deliveredAt: s.delivery.deliveredAt, fee: s.delivery.fee }
      : null,
    exceptions: staff
      ? s.exceptions.map((e) => ({ id: e.id, code: e.code, severity: e.severity, message: e.message, createdAt: e.createdAt }))
      : undefined,
  };
}

export type ShipmentView = Awaited<ReturnType<typeof getShipment>>;

export async function listInvoices(p: Principal, opts: { status?: Prisma.InvoiceWhereInput["status"] } = {}) {
  return db.invoice.findMany({
    where: { AND: [invoiceScope(p), opts.status ? { status: opts.status } : {}] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, reference: true, status: true, governmentTotal: true, brokerTotal: true, total: true,
      amountPaid: true, issuedAt: true, dueAt: true,
      shipment: { select: { id: true, reference: true } },
    },
  });
}

export async function getInvoice(p: Principal, id: string) {
  const invoice = await db.invoice.findFirst({
    where: { AND: [invoiceScope(p), { id }] },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      shipment: { select: { id: true, reference: true } },
    },
  });
  if (!invoice) throw new DomainError("Invoice not found.", 404);
  if (isStaff(p.role)) return invoice;
  return {
    ...invoice,
    payments: invoice.payments.map((pay) => ({
      id: pay.id, amount: pay.amount, status: pay.status, receivedAt: pay.receivedAt, provider: pay.provider,
    })),
  };
}

/**
 * The customer's Home: counts by what is happening, what they have paid the
 * government through us, and their latest status changes.
 */
export async function customerOverview(p: Principal) {
  const [shipments, paid, history] = await Promise.all([
    db.shipment.findMany({ where: shipmentScope(p), select: { status: true } }),
    db.invoice.aggregate({
      where: { AND: [invoiceScope(p), { status: "PAID" }] },
      _sum: { governmentTotal: true },
    }),
    db.shipmentStatusHistory.findMany({
      where: { shipment: shipmentScope(p) },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true, to: true, createdAt: true,
        shipment: { select: { id: true, reference: true, description: true, deliveryRequested: true } },
      },
    }),
  ]);
  const count = (statuses: ShipmentStatus[]) => shipments.filter((s) => statuses.includes(s.status)).length;
  return {
    total: shipments.length,
    active: shipments.filter((s) => s.status !== "DELIVERED" && s.status !== "CANCELLED").length,
    needsYou: count(CUSTOMER_ACTION_STATUSES),
    released: count(["CUSTOMS_RELEASED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"]),
    completed: count(["DELIVERED"]),
    governmentPaid: paid._sum.governmentTotal ?? 0,
    activity: history.map((h) => ({
      id: h.id,
      label: customerLabel(h.to, h.shipment.deliveryRequested),
      status: h.to,
      at: h.createdAt,
      shipment: { id: h.shipment.id, reference: h.shipment.reference, description: h.shipment.description },
    })),
  };
}
