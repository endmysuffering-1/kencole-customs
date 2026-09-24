import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { supersedeRateRule } from "@/lib/services/rate-service";
import { rateSupersedeSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** A rate is never edited: this closes the rule and opens its successor. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireCapability("rates:edit");
  const input = await parseBody(req, rateSupersedeSchema);
  const rule = await supersedeRateRule({ ...input, actorId: user.id, rateRuleId: (await params).id });
  return json({ rule: { id: rule.id } }, 201);
});
