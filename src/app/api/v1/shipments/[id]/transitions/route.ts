import { requireUser } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { requestTransition } from "@/lib/services/shipment-service";
import { transitionSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Staff move shipments through the workflow; a customer may only withdraw one early. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  const { to, note } = await parseBody(req, transitionSchema);
  const shipment = await requestTransition({ principal: user, shipmentId: (await params).id, to, note });
  return json({ shipment: { id: shipment.id, status: shipment.status } });
});
