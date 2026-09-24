import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import { SESSION_COOKIE as COOKIE } from "./cookie";
import { can, canAccessResource, type Capability, type OwnedResource, type Principal, type Role } from "./rbac";
const TTL_MS = 1000 * 60 * 60 * 12;

/** The cookie holds a random token; the database holds only its hash. A leaked
 *  database backup therefore does not hand over live sessions. */
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const hdrs = await headers();
  await db.session.create({
    data: {
      tokenHash: hash(token),
      userId,
      expiresAt: new Date(Date.now() + TTL_MS),
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: hdrs.get("user-agent") ?? null,
    },
  });
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hash(token) } });
  store.delete(COOKIE);
}

export interface SessionUser extends Principal {
  email: string;
  fullName: string;
}

/** Cached per request so a page with six server components does one query. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { include: { memberships: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.active || session.user.deletedAt) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    fullName: session.user.fullName,
    role: session.user.role as Role,
    businessIds: session.user.memberships.map((m) => m.businessId),
  };
});

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403 = 403) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Sign in to continue.", 401);
  return user;
}

export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) {
    throw new AuthError("Your account does not have access to this.", 403);
  }
  return user;
}

/** Capability plus ownership. Use this, not requireCapability, whenever a
 *  specific record is involved. */
export async function requireResourceAccess(
  resource: OwnedResource,
  mode: "read" | "write" = "read",
): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccessResource(user, resource, mode)) {
    throw new AuthError("Your account does not have access to this.", 403);
  }
  return user;
}

export async function clientMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const hdrs = await headers();
  return {
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
  };
}
