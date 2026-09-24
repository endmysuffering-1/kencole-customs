import { handle, json, parseBody } from "@/lib/api/respond";
import { quickEstimate } from "@/lib/services/shipment-service";
import { estimateSchema } from "@/lib/validation/schemas";

/** Public: the landed-cost calculator. No account, list prices only. */
export const POST = handle(async (req) => {
  const input = await parseBody(req, estimateSchema);
  return json({ estimate: await quickEstimate(input) });
});
