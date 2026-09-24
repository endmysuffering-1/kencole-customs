import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { suggestForItem } from "@/lib/services/classification-service";
import { suggestSchema } from "@/lib/validation/schemas";

/** Suggestions only. Nothing here classifies a line; a broker's decision does. */
export const POST = handle(async (req) => {
  await requireCapability("classification:suggest");
  const { itemId } = await parseBody(req, suggestSchema);
  return json({ suggestions: await suggestForItem(itemId) });
});
