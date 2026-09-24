import type { Role } from "./rbac";

/** Roles in words, for anywhere a person reads them. */
export const ROLE_NAMES: Record<Role, string> = {
  CONSUMER: "Personal", BUSINESS_USER: "Business", BUSINESS_ADMIN: "Business admin",
  CUSTOMS_BROKER: "Licensed broker", OPERATIONS: "Operations", DRIVER: "Driver", SUPER_ADMIN: "Administrator",
};

export const ROLES = Object.keys(ROLE_NAMES) as Role[];
