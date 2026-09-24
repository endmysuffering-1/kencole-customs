import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { recordPaymentAndAdvance } from "@/lib/services/billing-flow";
import { paymentSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Staff record a payment that has arrived: a bank transfer, cash at the counter. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireCapability("payment:record");
  const input = await parseBody(req, paymentSchema);
  const payment = await recordPaymentAndAdvance({
    invoiceId: (await params).id, amount: input.amount, provider: input.provider,
    providerRef: input.providerRef, actorId: user.id,
  });
  return json({ payment }, 201);
});
