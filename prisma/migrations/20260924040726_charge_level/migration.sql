-- CreateEnum
CREATE TYPE "ChargeLevel" AS ENUM ('LINE', 'SHIPMENT');

-- AlterTable
ALTER TABLE "ChargeType" ADD COLUMN     "level" "ChargeLevel" NOT NULL DEFAULT 'LINE';
