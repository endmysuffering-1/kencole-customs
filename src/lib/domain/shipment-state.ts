/**
 * Shipment state machine.
 *
 * Transitions are declared as data so the operational flow can be reasoned about
 * (and tested) without reading through service code. Two guards matter most:
 * nothing reaches SUBMITTED_TO_CUSTOMS without a broker approval, and nothing
 * reaches PAID without a settled invoice.
 */

export type ShipmentStatus =
  | "DRAFT"
  | "DOCUMENTS_REQUIRED"
  | "DOCUMENTS_RECEIVED"
  | "UNDER_REVIEW"
  | "CLASSIFICATION_REVIEW"
  | "QUOTE_READY"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "DECLARATION_PREPARED"
  | "SUBMITTED_TO_CUSTOMS"
  | "CUSTOMS_REVIEW"
  | "CUSTOMS_HOLD"
  | "DUTIES_DUE"
  | "CUSTOMS_RELEASED"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  DRAFT: ["DOCUMENTS_REQUIRED", "DOCUMENTS_RECEIVED", "CANCELLED"],
  DOCUMENTS_REQUIRED: ["DOCUMENTS_RECEIVED", "CANCELLED"],
  DOCUMENTS_RECEIVED: ["UNDER_REVIEW", "DOCUMENTS_REQUIRED", "CANCELLED"],
  UNDER_REVIEW: ["CLASSIFICATION_REVIEW", "QUOTE_READY", "DOCUMENTS_REQUIRED", "CANCELLED"],
  CLASSIFICATION_REVIEW: ["QUOTE_READY", "DOCUMENTS_REQUIRED", "CANCELLED"],
  QUOTE_READY: ["AWAITING_PAYMENT", "CLASSIFICATION_REVIEW", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "QUOTE_READY", "CANCELLED"],
  // Kencole clears goods already in The Bahamas, so there is no freight leg:
  // once paid, the entry is prepared.
  PAID: ["DECLARATION_PREPARED", "CANCELLED"],
  DECLARATION_PREPARED: ["SUBMITTED_TO_CUSTOMS", "CLASSIFICATION_REVIEW", "CANCELLED"],
  SUBMITTED_TO_CUSTOMS: ["CUSTOMS_REVIEW", "CUSTOMS_HOLD", "DUTIES_DUE", "CUSTOMS_RELEASED"],
  CUSTOMS_REVIEW: ["CUSTOMS_HOLD", "DUTIES_DUE", "CUSTOMS_RELEASED"],
  CUSTOMS_HOLD: ["CUSTOMS_REVIEW", "DUTIES_DUE", "CUSTOMS_RELEASED", "CANCELLED"],
  DUTIES_DUE: ["CUSTOMS_RELEASED", "CUSTOMS_HOLD"],
  CUSTOMS_RELEASED: ["READY_FOR_DELIVERY", "DELIVERED"],
  READY_FOR_DELIVERY: ["OUT_FOR_DELIVERY", "DELIVERED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "READY_FOR_DELIVERY"],
  DELIVERED: [],
  CANCELLED: [],
};

export interface TransitionGuardContext {
  brokerApproved: boolean;
  invoiceSettled: boolean;
  hasRequiredDocuments: boolean;
}

/** Guards that cannot be satisfied by a status click alone. */
const GUARDS: Partial<Record<ShipmentStatus, (c: TransitionGuardContext) => string | null>> = {
  SUBMITTED_TO_CUSTOMS: (c) =>
    c.brokerApproved ? null : "A licensed broker must approve every classification before submission.",
  DECLARATION_PREPARED: (c) =>
    c.brokerApproved ? null : "Classifications are still awaiting broker approval.",
  PAID: (c) => (c.invoiceSettled ? null : "The invoice has not been settled in full."),
  UNDER_REVIEW: (c) =>
    c.hasRequiredDocuments ? null : "A commercial invoice is required before review can start.",
};

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

export function canTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
  ctx: TransitionGuardContext,
): TransitionResult {
  if (from === to) return { ok: false, reason: "The shipment is already in that status." };
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `${label(from)} cannot move to ${label(to)}.` };
  }
  const guard = GUARDS[to];
  const failure = guard?.(ctx);
  return failure ? { ok: false, reason: failure } : { ok: true };
}

/** What operations staff see. */
export function label(status: ShipmentStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * What the customer sees. The brief is explicit that a consumer should never have
 * to learn the word "declarant" to understand where their package is.
 */
export const CUSTOMER_LABEL: Record<ShipmentStatus, string> = {
  DRAFT: "Not submitted yet",
  DOCUMENTS_REQUIRED: "We need a document from you",
  DOCUMENTS_RECEIVED: "Documents received",
  UNDER_REVIEW: "We're checking your paperwork",
  CLASSIFICATION_REVIEW: "We're reviewing your items for customs",
  QUOTE_READY: "Your estimate is ready",
  AWAITING_PAYMENT: "Payment needed to continue",
  PAID: "Payment received",
  DECLARATION_PREPARED: "Entry prepared for customs",
  SUBMITTED_TO_CUSTOMS: "With Bahamas Customs",
  CUSTOMS_REVIEW: "Bahamas Customs is reviewing it",
  CUSTOMS_HOLD: "Held by Bahamas Customs",
  DUTIES_DUE: "Duties assessed and due",
  CUSTOMS_RELEASED: "Released by customs",
  READY_FOR_DELIVERY: "Ready for delivery",
  OUT_FOR_DELIVERY: "Out for delivery today",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/**
 * A customer who collects from the port, airport or courier sees "Collected"
 * where one who asked for delivery sees "Delivered": the same status, handed
 * over in a different way.
 */
export function customerLabel(status: ShipmentStatus, deliveryRequested: boolean): string {
  if (!deliveryRequested && status === "CUSTOMS_RELEASED") return "Released, ready to collect";
  if (!deliveryRequested && status === "DELIVERED") return "Collected";
  return CUSTOMER_LABEL[status];
}

/** Statuses where the next move is the customer's: send a document, accept, pay. */
export const CUSTOMER_ACTION_STATUSES: ShipmentStatus[] = ["DRAFT", "DOCUMENTS_REQUIRED", "QUOTE_READY", "AWAITING_PAYMENT"];

/** The six milestones shown on the customer timeline, in order. */
export const CUSTOMER_MILESTONES: { key: string; label: string; statuses: ShipmentStatus[] }[] = [
  { key: "documents", label: "Documents received", statuses: ["DOCUMENTS_RECEIVED", "UNDER_REVIEW", "CLASSIFICATION_REVIEW"] },
  { key: "review", label: "Shipment reviewed", statuses: ["QUOTE_READY"] },
  { key: "payment", label: "Payment received", statuses: ["PAID", "AWAITING_PAYMENT"] },
  { key: "customs", label: "Customs clearance", statuses: ["DECLARATION_PREPARED", "SUBMITTED_TO_CUSTOMS", "CUSTOMS_REVIEW", "CUSTOMS_HOLD", "DUTIES_DUE"] },
  { key: "release", label: "Released", statuses: ["CUSTOMS_RELEASED"] },
  { key: "delivery", label: "Delivered", statuses: ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"] },
];

/** The timeline for one shipment: the last step reads "Collected" when the
 *  customer is picking the goods up themselves. */
export function customerMilestones(deliveryRequested: boolean) {
  return CUSTOMER_MILESTONES.map((m) =>
    m.key === "delivery" && !deliveryRequested ? { ...m, label: "Collected" } : m,
  );
}

const ORDER: ShipmentStatus[] = [
  "DRAFT", "DOCUMENTS_REQUIRED", "DOCUMENTS_RECEIVED", "UNDER_REVIEW", "CLASSIFICATION_REVIEW",
  "QUOTE_READY", "AWAITING_PAYMENT", "PAID", "DECLARATION_PREPARED", "SUBMITTED_TO_CUSTOMS", "CUSTOMS_REVIEW", "CUSTOMS_HOLD", "DUTIES_DUE",
  "CUSTOMS_RELEASED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED",
];

export function milestoneState(
  current: ShipmentStatus,
  milestoneStatuses: ShipmentStatus[],
): "done" | "active" | "pending" {
  if (current === "CANCELLED") return "pending";
  const currentIndex = ORDER.indexOf(current);
  const indexes = milestoneStatuses.map((s) => ORDER.indexOf(s)).filter((i) => i >= 0);
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  if (currentIndex > last) return "done";
  if (currentIndex >= first) return "active";
  return "pending";
}
