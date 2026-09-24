import { requireCapability, requireUser } from "@/lib/auth/session";
import { handle, json, parseBody, parseQuery } from "@/lib/api/respond";
import { listShipments } from "@/lib/services/shipment-queries";
import { openShipment } from "@/lib/services/shipment-service";
import { createShipmentSchema, listShipmentsQuery } from "@/lib/validation/schemas";

export const GET = handle(async (req) => {
  const user = await requireUser();
  return json(await listShipments(user, parseQuery(req, listShipmentsQuery)));
});

export const POST = handle(async (req) => {
  const user = await requireCapability("shipment:create");
  const data = await parseBody(req, createShipmentSchema);
  const shipment = await openShipment({ principal: user, data });
  return json({ shipment: { id: shipment.id, reference: shipment.reference } }, 201);
});
