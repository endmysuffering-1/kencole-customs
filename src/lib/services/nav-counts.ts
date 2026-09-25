import { db } from "@/lib/db";
import { can, isStaff, type Principal } from "@/lib/auth/rbac";
import { CUSTOMER_ACTION_STATUSES } from "@/lib/domain/shipment-state";
import { shipmentScope } from "./shipment-queries";

const OPEN = { deletedAt: null, status: { notIn: ["DELIVERED" as const, "CANCELLED" as const] } };

/** The small numbers beside sidebar items: what is waiting for this person. */
export async function navCounts(p: Principal) {
  const [shipments, ops, broker] = await Promise.all([
    !isStaff(p.role) && can(p.role, "shipment:read:own")
      ? db.shipment.count({ where: { AND: [shipmentScope(p), { status: { in: CUSTOMER_ACTION_STATUSES } }] } })
      : 0,
    can(p.role, "ops:queue")
      ? db.exceptionFlag.count({ where: { resolvedAt: null, severity: "CRITICAL", shipment: OPEN } })
      : 0,
    can(p.role, "classification:approve")
      ? db.shipmentItem.count({
          where: {
            classificationStatus: { not: "BROKER_APPROVED" },
            shipment: { deletedAt: null, status: { in: ["UNDER_REVIEW", "CLASSIFICATION_REVIEW", "QUOTE_READY", "DECLARATION_PREPARED"] } },
          },
        })
      : 0,
  ]);
  return { shipments, ops, broker };
}
