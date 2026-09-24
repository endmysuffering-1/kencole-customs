import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { setUserActive } from "@/lib/services/user-service";
import { userAccessSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Switch an account off (ending its sessions) or back on. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireCapability("users:manage");
  const { active, reason } = await parseBody(req, userAccessSchema);
  const updated = await setUserActive({ actorId: user.id, userId: (await params).id, active, reason });
  return json({ user: { id: updated.id, active: updated.active } });
});
