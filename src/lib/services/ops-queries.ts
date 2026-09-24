import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type Principal } from "@/lib/auth/rbac";
import { label, type ShipmentStatus } from "@/lib/domain/shipment-state";
import { STALE_HOURS } from "@/lib/domain/exceptions";
import { DomainError } from "./errors";

/**
 * The work queues staff see. Each queue is a set of statuses and the team that
 * moves them on; a shipment sits in exactly one. Delivered and cancelled work
 * has left the queues.
 */
export const OPS_QUEUES: { key: string; title: string; hint: string; statuses: ShipmentStatus[] }[] = [
  { key: "intake", title: "Waiting on paperwork", hint: "No commercial invoice yet, or we asked for another document.", statuses: ["DRAFT", "DOCUMENTS_REQUIRED"] },
  { key: "review", title: "Ready to review", hint: "Paperwork in. Check values and suggest tariff codes.", statuses: ["DOCUMENTS_RECEIVED", "UNDER_REVIEW"] },
  { key: "classification", title: "With the broker", hint: "Classifications waiting for a licensed broker.", statuses: ["CLASSIFICATION_REVIEW"] },
  { key: "customer", title: "Waiting on the customer", hint: "Quote sent or invoice unpaid.", statuses: ["QUOTE_READY", "AWAITING_PAYMENT"] },
  { key: "entry", title: "Paid, entry to lodge", hint: "Prepare the customs entry; the broker lodges it.", statuses: ["PAID", "DECLARATION_PREPARED"] },
  { key: "customs", title: "At customs", hint: "Submitted entries, holds and assessed duties.", statuses: ["SUBMITTED_TO_CUSTOMS", "CUSTOMS_REVIEW", "CUSTOMS_HOLD", "DUTIES_DUE"] },
  { key: "delivery", title: "Released", hint: "Awaiting collection, or on the way to the customer.", statuses: ["CUSTOMS_RELEASED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"] },
];

const SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

const boardSelect = {
  id: true, reference: true, status: true, description: true, goodsValue: true, currency: true,
  heldAt: true, deliveryRequested: true,
  updatedAt: true, createdAt: true,
  owner: { select: { fullName: true } },
  business: { select: { legalName: true, tradingName: true } },
  items: { select: { classificationStatus: true } },
  exceptions: { where: { resolvedAt: null }, select: { severity: true } },
  history: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
} satisfies Prisma.ShipmentSelect;

type BoardRow = Prisma.ShipmentGetPayload<{ select: typeof boardSelect }>;

function card(s: BoardRow, now: Date) {
  const since = s.history[0]?.createdAt ?? s.createdAt;
  const hours = (now.getTime() - since.getTime()) / 36e5;
  const limit = STALE_HOURS[s.status];
  const worst = s.exceptions.reduce<keyof typeof SEVERITY_RANK | null>(
    (w, e) => (w == null || SEVERITY_RANK[e.severity] < SEVERITY_RANK[w] ? e.severity : w),
    null,
  );
  return {
    id: s.id,
    reference: s.reference,
    status: s.status,
    statusLabel: label(s.status),
    description: s.description,
    heldAt: s.heldAt,
    deliveryRequested: s.deliveryRequested,
    goodsValue: s.goodsValue,
    customer: s.business ? (s.business.tradingName ?? s.business.legalName) : s.owner.fullName,
    lines: s.items.length,
    approvedLines: s.items.filter((i) => i.classificationStatus === "BROKER_APPROVED").length,
    openExceptions: s.exceptions.length,
    worstSeverity: worst,
    inStatusSince: since,
    hoursInStatus: Math.floor(hours),
    stale: limit != null && hours > limit,
  };
}

export type BoardCard = ReturnType<typeof card>;

/** Every open shipment, placed in its queue, oldest in status first. */
export async function opsBoard(p: Principal, now = new Date()) {
  if (!can(p.role, "ops:queue")) throw new DomainError("Not found.", 404);
  const rows = await db.shipment.findMany({
    where: { deletedAt: null, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    select: boardSelect,
  });
  const cards = rows.map((r) => card(r, now)).sort((a, b) => a.inStatusSince.getTime() - b.inStatusSince.getTime());

  const exceptions = await db.exceptionFlag.findMany({
    where: { resolvedAt: null, shipment: { deletedAt: null, status: { notIn: ["DELIVERED", "CANCELLED"] } } },
    select: { id: true, code: true, severity: true, message: true, createdAt: true, shipment: { select: { id: true, reference: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  exceptions.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const unpaid = await db.invoice.findMany({
    where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
    select: {
      id: true, reference: true, status: true, total: true, amountPaid: true, dueAt: true,
      shipment: { select: { id: true, reference: true } },
    },
    orderBy: { dueAt: "asc" },
    take: 100,
  });

  return {
    queues: OPS_QUEUES.map((q) => ({ ...q, shipments: cards.filter((c) => q.statuses.includes(c.status)) })),
    exceptions,
    unpaid,
    staleCount: cards.filter((c) => c.stale).length,
  };
}

/**
 * The broker's desk: lines still needing a licensed decision, and entries
 * prepared and waiting to be lodged with customs.
 */
export async function brokerQueue(p: Principal, now = new Date()) {
  if (!can(p.role, "classification:approve")) throw new DomainError("Not found.", 404);
  const [toClassify, toSubmit] = await Promise.all([
    db.shipment.findMany({
      where: {
        deletedAt: null,
        status: { in: ["UNDER_REVIEW", "CLASSIFICATION_REVIEW", "QUOTE_READY", "DECLARATION_PREPARED"] },
        items: { some: { classificationStatus: { not: "BROKER_APPROVED" } } },
      },
      select: boardSelect,
    }),
    db.shipment.findMany({ where: { deletedAt: null, status: "DECLARATION_PREPARED" }, select: boardSelect }),
  ]);
  const byAge = (a: BoardCard, b: BoardCard) => a.inStatusSince.getTime() - b.inStatusSince.getTime();
  return {
    toClassify: toClassify.map((r) => card(r, now)).sort(byAge),
    toSubmit: toSubmit.map((r) => card(r, now)).sort(byAge),
  };
}
