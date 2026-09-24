import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseQuery } from "@/lib/api/respond";
import { listUsers } from "@/lib/services/user-service";
import { listUsersQuery } from "@/lib/validation/schemas";

export const GET = handle(async (req) => {
  const user = await requireCapability("users:manage");
  return json(await listUsers(user, parseQuery(req, listUsersQuery)));
});
