import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/auth/rbac";
import { DomainError } from "./errors";

/**
 * Changing someone's role. Who may do it is decided here, from the actor's role
 * as the database holds it now, not from whatever the caller says it is — so a
 * forged or stale session cannot talk its way into SUPER_ADMIN.
 */
export async function changeUserRole(input: {
  actorId: string;
  userId: string;
  role: Role;
  reason: string;
}) {
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError("Give a reason for changing someone's role.");
  if (input.actorId === input.userId) throw new DomainError("You cannot change your own role.", 403);

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId } });
    if (!actor || !actor.active || actor.deletedAt || !can(actor.role, "users:manage")) {
      throw new DomainError("Your account cannot change roles.", 403);
    }

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new DomainError("User not found.", 404);

    // Holding users:manage is not enough to hand out or take away the top role.
    // That stays true even if users:manage is one day granted more widely.
    if ((input.role === "SUPER_ADMIN" || target.role === "SUPER_ADMIN") && actor.role !== "SUPER_ADMIN") {
      throw new DomainError("Only a super administrator can grant or remove that role.", 403);
    }
    if (target.role === input.role) return target;

    const updated = await tx.user.update({ where: { id: target.id }, data: { role: input.role } });
    await recordAudit(
      {
        actorId: actor.id,
        action: "user.role_changed",
        entityType: "User",
        entityId: target.id,
        oldValue: { role: target.role },
        newValue: { role: input.role },
        reason,
      },
      tx,
    );
    return updated;
  });
}
