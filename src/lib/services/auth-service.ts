import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import type { registrationSchema } from "@/lib/validation/schemas";
import { DomainError } from "./errors";

type Registration = z.infer<typeof registrationSchema>;

/** Failed sign-ins allowed per account inside the window before it is refused. */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Registration only ever creates a CONSUMER, or a BUSINESS_ADMIN of a business
 * the registrant has just created. No input chooses a role; staff roles are
 * granted afterwards through changeUserRole().
 */
export async function registerUser(input: Registration) {
  const problems = passwordProblems(input.password);
  if (problems.length) throw new DomainError(problems.join(" "));

  const isBusiness = input.accountType === "business";
  const companyName = input.companyName?.trim();
  if (isBusiness && !companyName) throw new DomainError("Enter your company's name.");

  const passwordHash = await hashPassword(input.password);
  const role = isBusiness ? ("BUSINESS_ADMIN" as const) : ("CONSUMER" as const);

  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, fullName: input.fullName, phone: input.phone || null, passwordHash, role },
      });
      if (isBusiness) {
        await tx.business.create({
          data: {
            legalName: companyName!,
            billingEmail: input.email,
            members: { create: { userId: user.id, isAdmin: true } },
          },
        });
      } else {
        await tx.consumerProfile.create({ data: { userId: user.id } });
      }
      await recordAudit(
        { actorId: user.id, action: "user.registered", entityType: "User", entityId: user.id, newValue: { role } },
        tx,
      );
      return user;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("An account with that email already exists. Sign in instead.", 409);
    }
    throw e;
  }
}

// A real hash of a random password. Checking against it when the email is
// unknown makes a missing account take as long to refuse as a wrong password.
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword(randomBytes(24).toString("hex")));

/**
 * Checks a sign-in. Every refusal carries the same message whatever the cause —
 * unknown email, wrong password, deactivated account — so the answer does not
 * reveal which accounts exist.
 *
 * Failures are counted from the audit log rather than kept in memory, so the
 * limit holds across server instances and restarts.
 */
export async function authenticate(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();

  const failures = await db.auditLog.count({
    where: {
      action: "user.login_failed",
      entityType: "Login",
      entityId: email,
      createdAt: { gte: new Date(Date.now() - LOGIN_WINDOW_MS) },
    },
  });
  if (failures >= MAX_FAILED_LOGINS) {
    throw new DomainError("Too many failed attempts. Wait 15 minutes and try again.", 429);
  }

  const user = await db.user.findUnique({ where: { email } });
  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? (await decoyHash()));

  if (!user || !passwordOk || !user.active || user.deletedAt) {
    await recordAudit({ actorId: user?.id ?? null, action: "user.login_failed", entityType: "Login", entityId: email });
    throw new DomainError("That email and password don't match an account.", 401);
  }

  await recordAudit({ actorId: user.id, action: "user.login", entityType: "User", entityId: user.id });
  return user;
}

/** What a client is allowed to know about the signed-in account. */
export function publicUser(user: { id: string; email: string; fullName: string; role: string }) {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}
