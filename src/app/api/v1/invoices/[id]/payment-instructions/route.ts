import { requireUser } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";
import { paymentInstructions } from "@/lib/services/invoice-service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  return json({ payment: await paymentInstructions(user, (await params).id) });
});
