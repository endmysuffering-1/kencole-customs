import type { Role } from "./rbac";

/** Where someone lands after signing in. */
export function homeFor(role: Role): string {
  if (role === "CUSTOMS_BROKER") return "/broker";
  if (role === "OPERATIONS" || role === "SUPER_ADMIN") return "/ops";
  return "/dashboard";
}

/** A path on this site, or nothing: a ?next= link must not bounce anyone elsewhere. */
export function safeNext(next: string | string[] | undefined | null): string | null {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
