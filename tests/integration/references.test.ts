import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { nextInvoiceReference, nextQuoteReference, nextShipmentReference } from "@/lib/services/references";

beforeEach(resetCounters);
async function resetCounters() {
  await db.referenceCounter.deleteMany();
}

const MID_2026 = new Date("2026-06-01T12:00:00Z");

describe("reference allocation", () => {
  it("numbers shipments sequentially within the year", async () => {
    expect(await nextShipmentReference("KCB", MID_2026)).toBe("KCB-2026-000001");
    expect(await nextShipmentReference("KCB", MID_2026)).toBe("KCB-2026-000002");
    expect(await nextShipmentReference("KCB", new Date("2027-06-01T12:00:00Z"))).toBe("KCB-2027-000001");
  });

  it("never re-issues a number, whatever happens to the record that carried it", async () => {
    const first = await nextShipmentReference("KCB", MID_2026);
    // Nothing about the rows that exist feeds the counter, so deleting them cannot rewind it.
    await db.shipment.deleteMany();
    expect(await nextShipmentReference("KCB", MID_2026)).not.toBe(first);
  });

  it("gives concurrent callers distinct numbers", async () => {
    const refs = await Promise.all(Array.from({ length: 25 }, () => nextShipmentReference("KCB", MID_2026)));
    expect(new Set(refs).size).toBe(25);
    expect([...refs].sort().at(-1)).toBe("KCB-2026-000025");
  });

  it("numbers quotes and invoices per shipment", async () => {
    expect(await nextQuoteReference("ship-1", "KCB-2026-000001")).toBe("Q-KCB-2026-000001-1");
    expect(await nextQuoteReference("ship-1", "KCB-2026-000001")).toBe("Q-KCB-2026-000001-2");
    expect(await nextQuoteReference("ship-2", "KCB-2026-000002")).toBe("Q-KCB-2026-000002-1");
    expect(await nextInvoiceReference("ship-1", "KCB-2026-000001")).toBe("INV-KCB-2026-000001-1");
  });

  it("takes the year in Nassau, not UTC", async () => {
    // 22:00 on 31 December in Nassau is already 1 January in UTC.
    expect(await nextShipmentReference("KCB", new Date("2027-01-01T03:00:00Z"))).toMatch(/^KCB-2026-/);
  });

  it("returns the number to the pool when the transaction that took it rolls back", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await nextShipmentReference("KCB", MID_2026, tx);
        throw new Error("abandoned");
      }),
    ).rejects.toThrow("abandoned");
    // Nothing carrying that number was ever written, so handing it out again is safe.
    expect(await nextShipmentReference("KCB", MID_2026)).toBe("KCB-2026-000001");
  });
});
