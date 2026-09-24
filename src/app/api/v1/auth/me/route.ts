import { requireUser } from "@/lib/auth/session";
import { capabilitiesFor } from "@/lib/auth/rbac";
import { handle, json } from "@/lib/api/respond";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ user: { ...user, capabilities: capabilitiesFor(user.role) } });
});
