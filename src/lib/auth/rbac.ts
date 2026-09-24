/**
 * Authorisation.
 *
 * Two layers, and both are required. Role capability answers "may this kind of
 * user ever do this?". Ownership answers "may this particular user touch this
 * particular record?". Skipping the second is how IDOR bugs happen, so every
 * resource check below takes the record, not just the role.
 */

export type Role =
  | "CONSUMER" | "BUSINESS_USER" | "BUSINESS_ADMIN"
  | "CUSTOMS_BROKER" | "OPERATIONS" | "DRIVER" | "SUPER_ADMIN";

export type Capability =
  | "shipment:create" | "shipment:read:own" | "shipment:read:any" | "shipment:edit:own"
  | "shipment:edit:any" | "shipment:transition"
  | "classification:suggest" | "classification:approve"
  | "declaration:prepare" | "declaration:submit"
  | "quote:issue" | "invoice:issue" | "payment:record"
  | "rates:read" | "rates:edit" | "pricing:edit" | "plans:edit"
  | "delivery:read:assigned" | "delivery:manage" | "delivery:complete"
  | "business:manage" | "users:manage" | "crm:manage"
  | "analytics:view" | "audit:view" | "ops:queue";

const CAPABILITIES: Record<Role, Capability[]> = {
  CONSUMER: ["shipment:create", "shipment:read:own", "shipment:edit:own"],
  BUSINESS_USER: ["shipment:create", "shipment:read:own", "shipment:edit:own"],
  BUSINESS_ADMIN: [
    "shipment:create", "shipment:read:own", "shipment:edit:own",
    "business:manage", "analytics:view",
  ],
  DRIVER: ["delivery:read:assigned", "delivery:complete"],
  OPERATIONS: [
    "shipment:read:any", "shipment:edit:any", "shipment:transition", "ops:queue",
    "classification:suggest", "declaration:prepare", "quote:issue", "invoice:issue",
    "payment:record", "delivery:manage", "rates:read", "crm:manage",
  ],
  // Only the broker may approve a classification or submit an entry. This is the
  // regulated boundary the whole application is built around.
  CUSTOMS_BROKER: [
    "shipment:read:any", "shipment:edit:any", "shipment:transition", "ops:queue",
    "classification:suggest", "classification:approve",
    "declaration:prepare", "declaration:submit",
    "quote:issue", "invoice:issue", "payment:record",
    "rates:read", "rates:edit", "delivery:manage", "analytics:view", "audit:view",
  ],
  SUPER_ADMIN: [],
};

const EXTRA: Capability[] = [
  "pricing:edit", "plans:edit", "users:manage", "analytics:view", "audit:view",
  "rates:edit", "crm:manage", "delivery:manage", "delivery:read:assigned",
];

/** Acts that need the broker's licence. Administering the system is not holding
 *  it, so SUPER_ADMIN inherits everything else but not these. */
const LICENSED: Capability[] = ["classification:approve", "declaration:submit"];

CAPABILITIES.SUPER_ADMIN = [
  ...new Set([...Object.values(CAPABILITIES).flat(), ...EXTRA]),
].filter((c) => !LICENSED.includes(c));

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

export function capabilitiesFor(role: Role): Capability[] {
  return [...CAPABILITIES[role]];
}

export interface Principal {
  id: string;
  role: Role;
  businessIds: string[];
}

export interface OwnedResource {
  ownerId: string;
  businessId?: string | null;
}

/**
 * Whether this principal may see this record at all. Staff roles pass on the
 * "any" capability; everyone else must own the record or belong to the business
 * that owns it.
 */
export function canAccessResource(
  principal: Principal,
  resource: OwnedResource,
  mode: "read" | "write" = "read",
): boolean {
  const anyCap: Capability = mode === "read" ? "shipment:read:any" : "shipment:edit:any";
  if (can(principal.role, anyCap)) return true;
  if (resource.ownerId === principal.id) return true;
  if (resource.businessId && principal.businessIds.includes(resource.businessId)) return true;
  return false;
}

export const STAFF_ROLES: Role[] = ["OPERATIONS", "CUSTOMS_BROKER", "SUPER_ADMIN"];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
