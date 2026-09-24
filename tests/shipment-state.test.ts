import { describe, expect, it } from "vitest";
import { canTransition, TRANSITIONS, type ShipmentStatus } from "@/lib/domain/shipment-state";
import { readyForDeclaration, type ClassificationStatus } from "@/lib/domain/classification";

const allGood = { brokerApproved: true, invoiceSettled: true, hasRequiredDocuments: true };
const STATUSES = Object.keys(TRANSITIONS) as ShipmentStatus[];
const sourcesOf = (to: ShipmentStatus) => STATUSES.filter((from) => TRANSITIONS[from].includes(to));

/** Statuses reachable from DRAFT without passing through any of `avoid`. */
function reachable(avoid: ShipmentStatus[] = []): Set<ShipmentStatus> {
  const seen = new Set<ShipmentStatus>(["DRAFT"]);
  const queue: ShipmentStatus[] = ["DRAFT"];
  while (queue.length) {
    for (const next of TRANSITIONS[queue.shift()!]) {
      if (avoid.includes(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe("broker approval guard", () => {
  it("refuses SUBMITTED_TO_CUSTOMS from every status that leads to it, unless a broker has approved", () => {
    const sources = sourcesOf("SUBMITTED_TO_CUSTOMS");
    expect(sources.length).toBeGreaterThan(0);
    for (const from of sources) {
      expect(canTransition(from, "SUBMITTED_TO_CUSTOMS", { ...allGood, brokerApproved: false }).ok).toBe(false);
      expect(canTransition(from, "SUBMITTED_TO_CUSTOMS", allGood).ok).toBe(true);
    }
  });

  it("refuses DECLARATION_PREPARED the same way", () => {
    for (const from of sourcesOf("DECLARATION_PREPARED")) {
      expect(canTransition(from, "DECLARATION_PREPARED", { ...allGood, brokerApproved: false }).ok).toBe(false);
    }
  });

  it("cannot reach SUBMITTED_TO_CUSTOMS without passing DECLARATION_PREPARED", () => {
    expect(reachable(["DECLARATION_PREPARED"]).has("SUBMITTED_TO_CUSTOMS")).toBe(false);
  });
});

describe("every line must carry a broker's approval", () => {
  const cases: [ClassificationStatus[], boolean][] = [
    [["BROKER_APPROVED"], true],
    [["BROKER_APPROVED", "BROKER_APPROVED"], true],
    [[], false],
    [["BROKER_APPROVED", "AI_SUGGESTED"], false],
    [["BROKER_APPROVED", "NEEDS_REVIEW"], false],
    [["BROKER_APPROVED", "UNCLASSIFIED"], false],
    [["BROKER_APPROVED", "EXCEPTION"], false],
  ];
  it.each(cases)("%j -> %s", (statuses, expected) => {
    expect(readyForDeclaration(statuses)).toBe(expected);
  });

  it("does not treat a confident machine suggestion as approval", () => {
    expect(readyForDeclaration(["AI_SUGGESTED"])).toBe(false);
  });
});

describe("payment guard", () => {
  it("refuses PAID from every status that leads to it, unless the invoice is settled", () => {
    const sources = sourcesOf("PAID");
    expect(sources.length).toBeGreaterThan(0);
    for (const from of sources) {
      expect(canTransition(from, "PAID", { ...allGood, invoiceSettled: false }).ok).toBe(false);
      expect(canTransition(from, "PAID", allGood).ok).toBe(true);
    }
  });

  it("cannot reach customs, release or delivery without passing PAID", () => {
    const withoutPaying = reachable(["PAID"]);
    for (const s of ["DECLARATION_PREPARED", "SUBMITTED_TO_CUSTOMS", "CUSTOMS_RELEASED", "DELIVERED"] as const) {
      expect(withoutPaying.has(s)).toBe(false);
    }
  });
});

describe("the status graph", () => {
  it("can reach every status from DRAFT", () => {
    expect([...reachable()].sort()).toEqual([...STATUSES].sort());
  });

  it("treats DELIVERED and CANCELLED as final", () => {
    expect(TRANSITIONS.DELIVERED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("refuses a move to the status a shipment is already in", () => {
    for (const s of STATUSES) expect(canTransition(s, s, allGood).ok).toBe(false);
  });

  it("refuses review without a commercial invoice", () => {
    for (const from of sourcesOf("UNDER_REVIEW")) {
      expect(canTransition(from, "UNDER_REVIEW", { ...allGood, hasRequiredDocuments: false }).ok).toBe(false);
    }
  });
});
