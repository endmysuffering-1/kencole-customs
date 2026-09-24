/**
 * Exception engine. Runs on every save and flags what a careful clerk would
 * notice — missing paperwork, values that moved after approval, duplicates,
 * shipments that have sat too long in one queue.
 */

import { money } from "@/lib/money";
import type { ShipmentStatus } from "./shipment-state";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

export interface ExceptionInput {
  hasCommercialInvoice: boolean;
  freightCost: string | number;
  goodsValue: string | number;
  freightMode: "AIR" | "SEA" | "COURIER";
  lines: { lineNumber: number; hsCode?: string | null; lineValue: string | number; regulated?: boolean }[];
  status: ShipmentStatus;
  statusChangedAt: Date;
  duplicateTrackingNumber?: boolean;
  duplicateInvoiceNumber?: boolean;
  valueChangedAfterApproval?: boolean;
  quotedGovernmentTotal?: string | number | null;
  assessedGovernmentTotal?: string | number | null;
  now?: Date;
}

export interface ExceptionFlag {
  code: string;
  severity: Severity;
  message: string;
}

/** Hours a shipment may sit in a queue before it is considered stuck. */
export const STALE_HOURS: Partial<Record<ShipmentStatus, number>> = {
  DOCUMENTS_REQUIRED: 72,
  CLASSIFICATION_REVIEW: 24,
  AWAITING_PAYMENT: 120,
  SUBMITTED_TO_CUSTOMS: 48,
  CUSTOMS_HOLD: 24,
  READY_FOR_DELIVERY: 48,
};

/** How far a customs assessment may differ from our quote before we look again. */
const ASSESSMENT_TOLERANCE = 0.05;

export function detectExceptions(input: ExceptionInput): ExceptionFlag[] {
  const flags: ExceptionFlag[] = [];
  const now = input.now ?? new Date();
  const goods = money(input.goodsValue);
  const freight = money(input.freightCost);

  if (!input.hasCommercialInvoice) {
    flags.push({ code: "MISSING_INVOICE", severity: "CRITICAL", message: "No commercial invoice on file." });
  }
  if (freight.isZero() && input.freightMode !== "COURIER") {
    flags.push({ code: "MISSING_FREIGHT", severity: "WARNING", message: "Freight cost is zero. Freight is dutiable and must be declared." });
  }
  if (goods.isZero()) {
    flags.push({ code: "ZERO_VALUE", severity: "CRITICAL", message: "Declared goods value is zero." });
  }
  // Freight above the goods value is legitimate for heavy, cheap cargo, but it is
  // also what an undervalued invoice looks like.
  if (goods.greaterThan(0) && freight.greaterThan(goods)) {
    flags.push({ code: "FREIGHT_EXCEEDS_VALUE", severity: "WARNING", message: "Freight exceeds the declared goods value. Confirm the invoice is complete." });
  }

  const lineTotal = input.lines.reduce((acc, l) => acc.plus(money(l.lineValue)), money(0));
  if (input.lines.length > 0 && !lineTotal.equals(goods)) {
    flags.push({ code: "LINE_VALUE_MISMATCH", severity: "WARNING", message: `Line items total ${lineTotal.toFixed(2)} but the shipment value is ${goods.toFixed(2)}.` });
  }

  for (const line of input.lines) {
    if (!line.hsCode) {
      flags.push({ code: "UNCLASSIFIED_LINE", severity: "WARNING", message: `Line ${line.lineNumber} has no tariff classification.` });
    }
    if (line.regulated) {
      flags.push({ code: "PERMIT_REQUIRED", severity: "CRITICAL", message: `Line ${line.lineNumber} may need a permit or licence before entry.` });
    }
  }

  if (input.duplicateTrackingNumber) {
    flags.push({ code: "DUPLICATE_TRACKING", severity: "WARNING", message: "This tracking number already appears on another shipment." });
  }
  if (input.duplicateInvoiceNumber) {
    flags.push({ code: "DUPLICATE_INVOICE", severity: "WARNING", message: "This invoice number has been used before." });
  }
  if (input.valueChangedAfterApproval) {
    flags.push({ code: "VALUE_CHANGED_POST_APPROVAL", severity: "CRITICAL", message: "A value changed after broker approval. The classification must be re-approved." });
  }

  const quoted = input.quotedGovernmentTotal;
  const assessed = input.assessedGovernmentTotal;
  if (quoted != null && assessed != null && money(quoted).greaterThan(0)) {
    const delta = money(assessed).minus(money(quoted)).abs().dividedBy(money(quoted));
    if (delta.greaterThan(ASSESSMENT_TOLERANCE)) {
      flags.push({ code: "ASSESSMENT_MISMATCH", severity: "WARNING", message: `Customs assessed ${money(assessed).toFixed(2)} against our estimate of ${money(quoted).toFixed(2)}.` });
    }
  }

  const limit = STALE_HOURS[input.status];
  if (limit) {
    const hours = (now.getTime() - input.statusChangedAt.getTime()) / 36e5;
    if (hours > limit) {
      flags.push({ code: "STUCK_IN_STATUS", severity: hours > limit * 2 ? "CRITICAL" : "INFO", message: `Sitting in this status for ${Math.floor(hours)} hours.` });
    }
  }

  return flags;
}
