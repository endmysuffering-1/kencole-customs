import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { decideClassification } from "@/lib/services/classification-service";
import { classificationDecisionSchema } from "@/lib/validation/schemas";

/** The regulated checkpoint: only a licensed broker holds classification:approve. */
export const POST = handle(async (req) => {
  const broker = await requireCapability("classification:approve");
  const input = await parseBody(req, classificationDecisionSchema);
  const item = await decideClassification({
    itemId: input.itemId,
    hsCode: input.hsCode,
    decision: input.decision,
    reason: input.reason || undefined,
    note: input.note || undefined,
    brokerId: broker.id,
  });
  return json({ item: { id: item.id, classificationStatus: item.classificationStatus } });
});
