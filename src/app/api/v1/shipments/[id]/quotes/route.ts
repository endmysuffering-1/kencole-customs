import { requireCapability } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";
import { getShipment } from "@/lib/services/shipment-queries";
import { issueQuote } from "@/lib/services/shipment-service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await requireCapability("quote:issue");
  const { id } = await params;
  await getShipment(user, id); // 404 unless visible
  const quote = await issueQuote(id, user.id);
  return json({ quote }, 201);
});
