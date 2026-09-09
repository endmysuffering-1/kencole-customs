import { db } from "@/lib/db";

/**
 * Reference allocation.
 *
 * Every reference here is quoted outside the system — on a customs entry, on an
 * invoice a customer files, over the phone — so two rules hold: a number is
 * never issued twice, and a number is never re-issued after the record it
 * belonged to is deleted.
 *
 * That rules out counting existing rows. `count() + 1` hands the same number to
 * two concurrent callers, and walks backwards the moment anything is deleted.
 */

/**
 * One statement, so the read and the write cannot be separated by another
 * caller. Prisma's upsert would usually compile to the same thing, but "usually"
 * is the entire failure mode being fixed here, so the SQL is written out.
 */
async function nextInSequence(key: string): Promise<number> {
  const rows = await db.$queryRaw<{ last: number }[]>`
    INSERT INTO "ReferenceCounter" ("key", "last", "updatedAt")
    VALUES (${key}, 1, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "last" = "ReferenceCounter"."last" + 1, "updatedAt" = NOW()
    RETURNING "last"
  `;
  const last = rows[0]?.last;
  if (last === undefined) throw new Error(`Could not allocate a reference for ${key}.`);
  return last;
}

/** KCB-2026-000417. Sequential within the year so a customer can read it out. */
export async function nextShipmentReference(prefix = "KCB", now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const n = await nextInSequence(`shipment:${prefix}:${year}`);
  return `${prefix}-${year}-${String(n).padStart(6, "0")}`;
}

/** Q-KCB-2026-000417-2. Numbered per shipment, so a re-quote is visibly the second. */
export async function nextQuoteReference(shipmentId: string, shipmentReference: string): Promise<string> {
  const n = await nextInSequence(`quote:${shipmentId}`);
  return `Q-${shipmentReference}-${n}`;
}

/** INV-KCB-2026-000417-1. */
export async function nextInvoiceReference(shipmentId: string, shipmentReference: string): Promise<string> {
  const n = await nextInSequence(`invoice:${shipmentId}`);
  return `INV-${shipmentReference}-${n}`;
}
