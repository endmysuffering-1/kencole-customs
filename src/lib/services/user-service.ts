import type { Prisma, Role } from "@prisma/client";
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

/**
 * Turning an account off or back on. Deactivating ends every session the
 * person holds, so it takes effect on their next request, not their next
 * sign-in. Nobody can switch off their own account, and only a super
 * administrator can switch another one off or on.
 */
export async function setUserActive(input: { actorId: string; userId: string; active: boolean; reason: string }) {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new DomainError(input.active ? "Give a reason for restoring this account." : "Give a reason for deactivating this account.");
  }
  if (input.actorId === input.userId) throw new DomainError("You cannot change your own account's access.", 403);

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId } });
    if (!actor || !actor.active || actor.deletedAt || !can(actor.role, "users:manage")) {
      throw new DomainError("Your account cannot change access.", 403);
    }

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target || target.deletedAt) throw new DomainError("User not found.", 404);
    if (target.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new DomainError("Only a super administrator can change another administrator's access.", 403);
    }
    if (target.active === input.active) return target;

    const updated = await tx.user.update({ where: { id: target.id }, data: { active: input.active } });
    if (!input.active) await tx.session.deleteMany({ where: { userId: target.id } });
    await recordAudit(
      {
        actorId: actor.id,
        action: input.active ? "user.reactivated" : "user.deactivated",
        entityType: "User",
        entityId: target.id,
        oldValue: { active: target.active },
        newValue: { active: input.active },
        reason,
      },
      tx,
    );
    return updated;
  });
}

const PAGE = 50;

/** Everyone with an account, for the people who manage accounts. */
export async function listUsers(
  p: { id: string; role: Role },
  opts: { q?: string; role?: Role; status?: "active" | "inactive"; cursor?: string } = {},
) {
  if (!can(p.role, "users:manage")) throw new DomainError("Not found.", 404);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(opts.role ? { role: opts.role } : {}),
    ...(opts.status ? { active: opts.status === "active" } : {}),
    ...(opts.q
      ? { OR: [{ fullName: { contains: opts.q, mode: "insensitive" } }, { email: { contains: opts.q, mode: "insensitive" } }] }
      : {}),
  };
  const [rows, counts] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true, fullName: true, email: true, phone: true, role: true, active: true, createdAt: true,
        memberships: { select: { isAdmin: true, business: { select: { legalName: true, tradingName: true } } } },
      },
    }),
    db.user.groupBy({ by: ["role"], where: { deletedAt: null }, _count: { _all: true } }),
  ]);
  const page = rows.slice(0, PAGE);
  // Sessions end at sign-out, so the audit log is the record of sign-ins.
  const logins = await db.auditLog.groupBy({
    by: ["actorId"],
    where: { action: "user.login", actorId: { in: page.map((u) => u.id) } },
    _max: { createdAt: true },
  });
  const lastLogin = new Map(logins.map((l) => [l.actorId, l._max.createdAt]));
  return {
    users: page.map(({ memberships, ...u }) => ({
      ...u,
      businesses: memberships.map((m) => ({ name: m.business.tradingName ?? m.business.legalName, isAdmin: m.isAdmin })),
      lastSignIn: lastLogin.get(u.id) ?? null,
      self: u.id === p.id,
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null,
    roleCounts: Object.fromEntries(counts.map((c) => [c.role, c._count._all])) as Partial<Record<Role, number>>,
  };
}

/** The last access changes, newest first, with who made them and why. */
export async function recentAccessChanges(p: { role: Role }) {
  if (!can(p.role, "users:manage")) throw new DomainError("Not found.", 404);
  const rows = await db.auditLog.findMany({
    where: { action: { in: ["user.role_changed", "user.deactivated", "user.reactivated"] } },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { actor: { select: { fullName: true } } },
  });
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: rows.map((r) => r.entityId) } }, select: { id: true, fullName: true } }))
      .map((u) => [u.id, u.fullName]),
  );
  return rows.map((r) => ({
    id: r.id, action: r.action, actor: r.actor?.fullName ?? "System", subject: names.get(r.entityId) ?? "Unknown",
    oldValue: r.oldValue, newValue: r.newValue, reason: r.reason, at: r.createdAt,
  }));
}
