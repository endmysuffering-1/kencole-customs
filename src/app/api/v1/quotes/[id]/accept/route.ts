import { requireUser } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";
import { acceptQuote } from "@/lib/services/shipment-service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  const invoice = await acceptQuote({ principal: user, quoteId: (await params).id });
  return json({ invoice: { id: invoice.id, reference: invoice.reference, total: invoice.total } }, 201);
});
