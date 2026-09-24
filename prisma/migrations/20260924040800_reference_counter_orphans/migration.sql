-- Corrects the backfill in 20260909012720_reference_counter, whose closing
-- comment was wrong.
--
-- That backfill took each year's starting number from surviving Shipment rows
-- only. An invoice outlives its shipment (Invoice.shipmentId is SetNull on
-- delete) and carries the shipment's reference inside its own. If a year's
-- highest-numbered shipment was deleted before that migration ran, the counter
-- restarted below it: the reference was issued again, and the new shipment's
-- first invoice collided with the orphan on Invoice_reference_key.
--
-- Raise every shipment counter to cover each shipment reference embedded in an
-- invoice: INV-KCB-2026-000417-1 -> key "shipment:KCB:2026", at least 417.
-- Quotes need no equivalent: they cascade-delete with their shipment.
INSERT INTO "ReferenceCounter" ("key", "last", "updatedAt")
SELECT
    'shipment:' || split_part("reference", '-', 2) || ':' || split_part("reference", '-', 3),
    MAX(CAST(split_part("reference", '-', 4) AS INTEGER)),
    NOW()
FROM "Invoice"
WHERE "reference" ~ '^INV-[A-Za-z]+-[0-9]{4}-[0-9]+-[0-9]+$'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE
    SET "last" = GREATEST("ReferenceCounter"."last", EXCLUDED."last");
