import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { authenticate, LOGIN_WINDOW_MS, MAX_FAILED_LOGINS, registerUser } from "@/lib/services/auth-service";
import { registrationSchema } from "@/lib/validation/schemas";
import { resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);

const GOOD_PASSWORD = "Correct-Horse-42";
/** The route parses with this schema before calling the service; so do the tests. */
const register = (body: Record<string, unknown>) =>
  registerUser(registrationSchema.parse({ fullName: "Test Person", password: GOOD_PASSWORD, ...body }));

describe("registration", () => {
  it("creates a consumer with a profile and a hashed password", async () => {
    const user = await register({ email: "Person@Example.com" });
    expect(user.role).toBe("CONSUMER");
    expect(user.email).toBe("person@example.com");
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);
    expect(await verifyPassword(GOOD_PASSWORD, user.passwordHash)).toBe(true);
    expect(await db.consumerProfile.count({ where: { userId: user.id } })).toBe(1);
  });

  it("makes a business registrant the admin of a business of their own", async () => {
    const user = await register({ email: "owner@example.com", accountType: "business", companyName: "Harbour Traders Ltd" });
    expect(user.role).toBe("BUSINESS_ADMIN");
    const membership = await db.businessMember.findFirstOrThrow({ where: { userId: user.id }, include: { business: true } });
    expect(membership.isAdmin).toBe(true);
    expect(membership.business.legalName).toBe("Harbour Traders Ltd");
  });

  it("ignores a role smuggled into the request", async () => {
    const user = await register({ email: "sneaky@example.com", role: "SUPER_ADMIN" });
    expect(user.role).toBe("CONSUMER");
  });

  it("refuses a weak password", async () => {
    await expect(register({ email: "weak@example.com", password: "alllowercase1" })).rejects.toThrow(/upper and lower/);
    expect(await db.user.count()).toBe(0);
  });

  it("refuses a second account on the same email, whatever its case", async () => {
    await register({ email: "dup@example.com" });
    await expect(register({ email: "DUP@example.com" })).rejects.toThrow(/already exists/);
  });

  it("needs a company name for a business account", async () => {
    await expect(register({ email: "biz@example.com", accountType: "business" })).rejects.toThrow(/company/);
  });

  it("records the registration", async () => {
    const user = await register({ email: "audit@example.com" });
    expect(await db.auditLog.count({ where: { action: "user.registered", entityId: user.id } })).toBe(1);
  });
});

describe("sign-in", () => {
  const failures = (email: string) =>
    db.auditLog.count({ where: { action: "user.login_failed", entityId: email } });

  it("accepts the right password and records it", async () => {
    const user = await register({ email: "in@example.com" });
    const signedIn = await authenticate({ email: "IN@example.com", password: GOOD_PASSWORD });
    expect(signedIn.id).toBe(user.id);
    expect(await db.auditLog.count({ where: { action: "user.login", entityId: user.id } })).toBe(1);
  });

  it("gives the same answer for a wrong password, an unknown email and a deactivated account", async () => {
    const user = await register({ email: "in@example.com" });
    const messages: string[] = [];
    const attempt = (email: string, password: string) =>
      authenticate({ email, password }).catch((e: Error) => messages.push(e.message));

    await attempt("in@example.com", "Wrong-Password-1");
    await attempt("nobody@example.com", GOOD_PASSWORD);
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    await attempt("in@example.com", GOOD_PASSWORD);

    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
  });

  it(`refuses an account after ${MAX_FAILED_LOGINS} failures, even with the right password`, async () => {
    await register({ email: "target@example.com" });
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await expect(authenticate({ email: "target@example.com", password: `Guess-${i}-Aa` })).rejects.toThrow(/don't match/);
    }
    await expect(authenticate({ email: "target@example.com", password: GOOD_PASSWORD })).rejects.toThrow(/Too many/);
    expect(await failures("target@example.com")).toBe(MAX_FAILED_LOGINS);
  });

  it("counts failures per account, so guessing at one does not lock out another", async () => {
    await register({ email: "target@example.com" });
    await register({ email: "bystander@example.com" });
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await authenticate({ email: "target@example.com", password: "Nope-Nope-1" }).catch(() => undefined);
    }
    await expect(authenticate({ email: "bystander@example.com", password: GOOD_PASSWORD })).resolves.toBeTruthy();
  });

  it("forgets failures older than the window", async () => {
    await register({ email: "later@example.com" });
    const old = new Date(Date.now() - LOGIN_WINDOW_MS - 60_000);
    await db.auditLog.createMany({
      data: Array.from({ length: MAX_FAILED_LOGINS }, () => ({
        action: "user.login_failed", entityType: "Login", entityId: "later@example.com", createdAt: old,
      })),
    });
    await expect(authenticate({ email: "later@example.com", password: GOOD_PASSWORD })).resolves.toBeTruthy();
  });
});
