import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { clientMeta } from "@/lib/auth/session";

/**
 * Append-only audit trail.
 *
 * There is no update or delete function in this module, and there deliberately
 * never will be. In production the application's database role should hold
 * INSERT and SELECT on "AuditLog" and nothing else — see docs/ARCHITECTURE.md.
 */

export type AuditAction =
  | "user.login" | "user.login_failed" | "user.logout" | "user.registered"
  | "user.role_changed" | "user.permissions_changed"
  | "shipment.created" | "shipment.updated" | "shipment.value_changed"
  | "shipment.status_changed" | "shipment.deleted"
  | "classification.suggested" | "classification.changed" | "classification.approved"
  | "rate.changed" | "pricing.changed" | "plan.changed"
  | "quote.issued" | "invoice.issued" | "invoice.voided" | "payment.recorded" | "payment.refunded"
  | "document.uploaded" | "document.deleted"
  | "declaration.prepared" | "declaration.submitted" | "declaration.reference_changed"
  | "exception.resolved";

export interface AuditEntry {
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  /** Required by the caller for overrides — see requireReason below. */
  reason?: string;
}

/** Actions where "because I said so" is not good enough. */
const REASON_REQUIRED: AuditAction[] = [
  "classification.changed", "shipment.value_changed", "rate.changed",
  "payment.refunded", "invoice.voided", "declaration.reference_changed", "user.role_changed",
];

export function requireReason(action: AuditAction): boolean {
  return REASON_REQUIRED.includes(action);
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (requireReason(entry.action) && !entry.reason?.trim()) {
    throw new Error(`A reason is required to record "${entry.action}".`);
  }
  const meta = await clientMeta().catch(() => ({}) as { ip?: string; userAgent?: string });
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as Prisma.InputJsonValue),
      newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
      reason: entry.reason ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
}

/** Narrow an object to the fields that actually changed, so the log stays readable. */
export function diff<T extends Record<string, unknown>>(
  before: T, after: Partial<T>,
): { oldValue: Partial<T>; newValue: Partial<T> } | null {
  const oldValue: Partial<T> = {};
  const newValue: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (String(before[key]) !== String(after[key])) {
      oldValue[key] = before[key];
      newValue[key] = after[key] as T[keyof T];
      changed = true;
    }
  }
  return changed ? { oldValue, newValue } : null;
}
