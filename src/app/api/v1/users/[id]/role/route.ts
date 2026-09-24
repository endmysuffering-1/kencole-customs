import { requireCapability } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { changeUserRole } from "@/lib/services/user-service";
import { userRoleSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireCapability("users:manage");
  const { role, reason } = await parseBody(req, userRoleSchema);
  const updated = await changeUserRole({ actorId: user.id, userId: (await params).id, role, reason });
  return json({ user: { id: updated.id, role: updated.role } });
});
