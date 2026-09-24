import { requireUser } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";
import { getInvoice } from "@/lib/services/shipment-queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  return json({ invoice: await getInvoice(user, (await params).id) });
});
