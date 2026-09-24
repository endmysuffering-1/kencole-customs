import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * scrypt from the Node standard library. Deliberately not a third-party hash:
 * fewer dependencies in the authentication path is worth more here than the
 * marginal tuning a dedicated library would give.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("Use at least 12 characters.");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) problems.push("Mix upper and lower case.");
  if (!/[0-9]/.test(password)) problems.push("Include a number.");
  return problems;
}
