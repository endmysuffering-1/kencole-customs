import { requireCapability, requireUser } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { issueInvoiceForQuote } from "@/lib/services/invoice-service";
import { listInvoices } from "@/lib/services/shipment-queries";
import { issueInvoiceSchema } from "@/lib/validation/schemas";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ invoices: await listInvoices(user) });
});

export const POST = handle(async (req) => {
  const user = await requireCapability("invoice:issue");
  const { quoteId } = await parseBody(req, issueInvoiceSchema);
  return json({ invoice: await issueInvoiceForQuote(quoteId, user.id) }, 201);
});
