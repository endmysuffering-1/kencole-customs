import { recordAudit } from "@/lib/audit";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";

export const POST = handle(async () => {
  const user = await getSessionUser();
  await destroySession();
  if (user) await recordAudit({ actorId: user.id, action: "user.logout", entityType: "User", entityId: user.id });
  return json({ ok: true });
});
