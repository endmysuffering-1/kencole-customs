-- Kencole clears goods that are already in The Bahamas: at a port, the airport,
-- or a courier's warehouse. It does not move freight here, so the two statuses
-- that tracked goods on their way (FREIGHT_IN_TRANSIT, ARRIVED_BAHAMAS) go.
--
-- A shipment sitting in either returns to PAID, the step before the entry is
-- prepared. Status-history rows that recorded them are removed so the type can
-- change, and the next row's "from" is pointed back at PAID, so each shipment's
-- chain still reads in order. The audit log is untouched and keeps the original
-- record. Until this change only seed data could hold these statuses.
UPDATE "Shipment" SET "status" = 'PAID' WHERE "status" IN ('FREIGHT_IN_TRANSIT', 'ARRIVED_BAHAMAS');
DELETE FROM "ShipmentStatusHistory" WHERE "to" IN ('FREIGHT_IN_TRANSIT', 'ARRIVED_BAHAMAS');
UPDATE "ShipmentStatusHistory" SET "from" = 'PAID' WHERE "from" IN ('FREIGHT_IN_TRANSIT', 'ARRIVED_BAHAMAS');

-- AlterEnum
CREATE TYPE "ShipmentStatus_new" AS ENUM ('DRAFT', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_RECEIVED', 'UNDER_REVIEW', 'CLASSIFICATION_REVIEW', 'QUOTE_READY', 'AWAITING_PAYMENT', 'PAID', 'DECLARATION_PREPARED', 'SUBMITTED_TO_CUSTOMS', 'CUSTOMS_REVIEW', 'CUSTOMS_HOLD', 'DUTIES_DUE', 'CUSTOMS_RELEASED', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
ALTER TABLE "Shipment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Shipment" ALTER COLUMN "status" TYPE "ShipmentStatus_new" USING ("status"::text::"ShipmentStatus_new");
ALTER TABLE "ShipmentStatusHistory" ALTER COLUMN "from" TYPE "ShipmentStatus_new" USING ("from"::text::"ShipmentStatus_new");
ALTER TABLE "ShipmentStatusHistory" ALTER COLUMN "to" TYPE "ShipmentStatus_new" USING ("to"::text::"ShipmentStatus_new");
ALTER TYPE "ShipmentStatus" RENAME TO "ShipmentStatus_old";
ALTER TYPE "ShipmentStatus_new" RENAME TO "ShipmentStatus";
DROP TYPE "ShipmentStatus_old";
ALTER TABLE "Shipment" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Where the goods are waiting, and whether the customer wants them delivered.
ALTER TABLE "Shipment" ADD COLUMN "deliveryRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "heldAt" TEXT;

-- Shipments that already have a delivery booked asked for one.
UPDATE "Shipment" SET "deliveryRequested" = true WHERE "id" IN (SELECT "shipmentId" FROM "Delivery");
