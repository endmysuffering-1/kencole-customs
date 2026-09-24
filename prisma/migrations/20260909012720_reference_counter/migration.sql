-- CreateTable
CREATE TABLE "ReferenceCounter" (
    "key" TEXT NOT NULL,
    "last" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("key")
);

-- Backfill from references already issued. Without this the first allocation
-- after this migration restarts at 1 and collides with existing rows.

-- Shipments: KCB-2026-000417 -> key "shipment:KCB:2026", last 417.
INSERT INTO "ReferenceCounter" ("key", "last", "updatedAt")
SELECT
    'shipment:' || split_part("reference", '-', 1) || ':' || split_part("reference", '-', 2),
    MAX(CAST(split_part("reference", '-', 3) AS INTEGER)),
    NOW()
FROM "Shipment"
WHERE "reference" ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE
    SET "last" = GREATEST("ReferenceCounter"."last", EXCLUDED."last");

-- Quotes and invoices are numbered per shipment, off the trailing segment.
INSERT INTO "ReferenceCounter" ("key", "last", "updatedAt")
SELECT 'quote:' || "shipmentId", MAX(CAST((regexp_match("reference", '([0-9]+)$'))[1] AS INTEGER)), NOW()
FROM "Quote"
WHERE "reference" ~ '[0-9]+$'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE
    SET "last" = GREATEST("ReferenceCounter"."last", EXCLUDED."last");

-- An invoice outlives its shipment (Invoice.shipmentId is SetNull on delete), so
-- orphans have no shipment to key against. They need no counter: shipment
-- references are never re-issued, so no future invoice can collide with them.
INSERT INTO "ReferenceCounter" ("key", "last", "updatedAt")
SELECT 'invoice:' || "shipmentId", MAX(CAST((regexp_match("reference", '([0-9]+)$'))[1] AS INTEGER)), NOW()
FROM "Invoice"
WHERE "shipmentId" IS NOT NULL AND "reference" ~ '[0-9]+$'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE
    SET "last" = GREATEST("ReferenceCounter"."last", EXCLUDED."last");
