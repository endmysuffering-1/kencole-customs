import { describe, expect, it } from "vitest";
import { can, canAccessResource, capabilitiesFor, type Principal, type Role } from "@/lib/auth/rbac";

const ROLES: Role[] = [
  "CONSUMER", "BUSINESS_USER", "BUSINESS_ADMIN", "CUSTOMS_BROKER", "OPERATIONS", "DRIVER", "SUPER_ADMIN",
];

const consumerA: Principal = { id: "consumer-a", role: "CONSUMER", businessIds: [] };
const consumerB: Principal = { id: "consumer-b", role: "CONSUMER", businessIds: [] };
const importerA: Principal = { id: "importer-a", role: "BUSINESS_USER", businessIds: ["biz-a"] };
const ownerA: Principal = { id: "owner-a", role: "BUSINESS_ADMIN", businessIds: ["biz-a"] };
const importerB: Principal = { id: "importer-b", role: "BUSINESS_USER", businessIds: ["biz-b"] };

const consumerBShipment = { ownerId: consumerB.id, businessId: null };
const businessBShipment = { ownerId: importerB.id, businessId: "biz-b" };
const businessAShipment = { ownerId: importerA.id, businessId: "biz-a" };

describe("cross-tenant access", () => {
  it("does not let consumer A read or change consumer B's shipment", () => {
    expect(canAccessResource(consumerA, consumerBShipment, "read")).toBe(false);
    expect(canAccessResource(consumerA, consumerBShipment, "write")).toBe(false);
  });

  it("lets a consumer read their own shipment", () => {
    expect(canAccessResource(consumerB, consumerBShipment, "read")).toBe(true);
  });

  it("does not let business A read or change business B's shipment", () => {
    for (const member of [importerA, ownerA]) {
      expect(canAccessResource(member, businessBShipment, "read")).toBe(false);
      expect(canAccessResource(member, businessBShipment, "write")).toBe(false);
    }
  });

  it("lets colleagues in one business see each other's shipments", () => {
    expect(canAccessResource(ownerA, businessAShipment, "read")).toBe(true);
  });

  it("does not let a business member into a consumer's personal shipment", () => {
    expect(canAccessResource(importerA, consumerBShipment, "read")).toBe(false);
  });

  it("does not open a shipment to a principal with no businesses on a null businessId", () => {
    expect(canAccessResource(consumerA, { ownerId: "someone-else", businessId: null })).toBe(false);
  });

  it("keeps drivers out of shipment records", () => {
    const driver: Principal = { id: "driver", role: "DRIVER", businessIds: [] };
    expect(canAccessResource(driver, consumerBShipment, "read")).toBe(false);
  });

  it("lets staff roles read any shipment", () => {
    for (const role of ["OPERATIONS", "CUSTOMS_BROKER", "SUPER_ADMIN"] as const) {
      expect(canAccessResource({ id: "staff", role, businessIds: [] }, businessBShipment, "read")).toBe(true);
    }
  });
});

describe("the regulated boundary", () => {
  it("gives classification:approve to the customs broker alone", () => {
    expect(ROLES.filter((r) => can(r, "classification:approve"))).toEqual(["CUSTOMS_BROKER"]);
  });

  it("gives declaration:submit to the customs broker alone", () => {
    expect(ROLES.filter((r) => can(r, "declaration:submit"))).toEqual(["CUSTOMS_BROKER"]);
  });
});

describe("privilege escalation", () => {
  it("does not give OPERATIONS the capability that changes roles", () => {
    expect(can("OPERATIONS", "users:manage")).toBe(false);
    expect(ROLES.filter((r) => can(r, "users:manage"))).toEqual(["SUPER_ADMIN"]);
  });

  it("does not let a caller grant itself a capability by mutating the list it was given", () => {
    capabilitiesFor("OPERATIONS").push("users:manage");
    expect(can("OPERATIONS", "users:manage")).toBe(false);
  });

  it("keeps rate and pricing edits away from roles outside the back office", () => {
    for (const role of ["CONSUMER", "BUSINESS_USER", "BUSINESS_ADMIN", "DRIVER", "OPERATIONS"] as const) {
      expect(can(role, "rates:edit")).toBe(false);
      expect(can(role, "pricing:edit")).toBe(false);
    }
  });
});
