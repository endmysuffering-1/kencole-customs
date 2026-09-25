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
  | "user.role_changed" | "user.permissions_changed" | "user.deactivated" | "user.reactivated"
  | "shipment.created" | "shipment.updated" | "shipment.value_changed"
  | "shipment.status_changed" | "shipment.deleted"
  | "classification.suggested" | "classification.changed" | "classification.approved"
  | "rate.changed" | "rate.created" | "pricing.changed" | "plan.changed"
  | "quote.issued" | "quote.accepted" | "invoice.issued" | "invoice.voided" | "payment.recorded" | "payment.refunded"
  | "document.uploaded" | "document.deleted"
  | "declaration.prepared" | "declaration.submitted" | "declaration.reference_changed"
  | "exception.resolved" | "reference.imported";

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
  "classification.changed", "shipment.value_changed", "rate.changed", "rate.created",
  "payment.refunded", "invoice.voided", "declaration.reference_changed", "user.role_changed",
  "user.deactivated", "user.reactivated", "reference.imported", "pricing.changed",
];

export function requireReason(action: AuditAction): boolean {
  return REASON_REQUIRED.includes(action);
}

/**
 * Pass the transaction the change itself is written in, and the change and its
 * record commit together: a change that cannot be audited is not made.
 */
export async function recordAudit(
  entry: AuditEntry,
  client: Prisma.TransactionClient = db,
): Promise<void> {
  if (requireReason(entry.action) && !entry.reason?.trim()) {
    throw new Error(`A reason is required to record "${entry.action}".`);
  }
  const meta = await clientMeta().catch(() => ({}) as { ip?: string; userAgent?: string });
  await client.auditLog.create({
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

/**
 * Many entries in one write, for bulk changes such as a spreadsheet import.
 * The same rule holds: every entry needs its reason, and passing the
 * transaction makes the changes and their records commit together.
 */
export async function recordAuditMany(
  entries: AuditEntry[],
  client: Prisma.TransactionClient = db,
): Promise<void> {
  if (entries.length === 0) return;
  for (const entry of entries) {
    if (requireReason(entry.action) && !entry.reason?.trim()) {
      throw new Error(`A reason is required to record "${entry.action}".`);
    }
  }
  const meta = await clientMeta().catch(() => ({}) as { ip?: string; userAgent?: string });
  const CHUNK = 1000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await client.auditLog.createMany({
      data: entries.slice(i, i + CHUNK).map((entry) => ({
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as Prisma.InputJsonValue),
        newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
        reason: entry.reason ?? null,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      })),
    });
  }
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
