import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CUSTOMER_ACTION_STATUSES, type ShipmentStatus } from "@/lib/domain/shipment-state";

/** Tone by where the shipment is, DockDrop style: coral needs you, amber in progress, green released. */
export function toneFor(status: string): BadgeTone {
  if ((CUSTOMER_ACTION_STATUSES as string[]).includes(status)) return "action";
  if (status === "CUSTOMS_HOLD") return "alert";
  if (["CUSTOMS_RELEASED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"].includes(status)) return "good";
  if (status === "DELIVERED") return "info";
  if (status === "CANCELLED") return "neutral";
  return "warn";
}

export function ShipmentStatusBadge({ status, label }: { status: ShipmentStatus | string; label: string }) {
  return <Badge tone={toneFor(status)}>{label}</Badge>;
}
