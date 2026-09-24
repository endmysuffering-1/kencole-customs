import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { createRateRule, listRateTable } from "@/lib/services/rate-service";
import { rateCreateSchema } from "@/lib/validation/schemas";

/** The government rate table: in force, scheduled and superseded. */
export const GET = handle(async () => {
  const user = await requireCapability("rates:read");
  return json(await listRateTable(user));
});

/** A rate for a heading or chapter no rule covers yet. */
export const POST = handle(async (req) => {
  const user = await requireCapability("rates:edit");
  const input = await parseBody(req, rateCreateSchema);
  const rule = await createRateRule({ ...input, actorId: user.id });
  return json({ rule: { id: rule.id } }, 201);
});
