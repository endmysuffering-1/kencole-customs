import { requireUser } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { getShipment } from "@/lib/services/shipment-queries";
import { updateShipment } from "@/lib/services/shipment-service";
import { shipmentUpdateSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  return json({ shipment: await getShipment(user, (await params).id) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const data = await parseBody(req, shipmentUpdateSchema);
  await updateShipment({ principal: user, shipmentId: id, data });
  return json({ shipment: await getShipment(user, id) });
});
