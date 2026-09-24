-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CONSUMER', 'BUSINESS_USER', 'BUSINESS_ADMIN', 'CUSTOMS_BROKER', 'OPERATIONS', 'DRIVER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "Payee" AS ENUM ('GOVERNMENT', 'BROKER');

-- CreateEnum
CREATE TYPE "ChargeBasis" AS ENUM ('PERCENT_OF_CUSTOMS_VALUE', 'PERCENT_OF_DUTIABLE_TOTAL', 'PERCENT_OF_GOODS_VALUE', 'FLAT', 'PER_LINE', 'PER_UNIT_WEIGHT');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_RECEIVED', 'UNDER_REVIEW', 'CLASSIFICATION_REVIEW', 'QUOTE_READY', 'AWAITING_PAYMENT', 'PAID', 'FREIGHT_IN_TRANSIT', 'ARRIVED_BAHAMAS', 'DECLARATION_PREPARED', 'SUBMITTED_TO_CUSTOMS', 'CUSTOMS_REVIEW', 'CUSTOMS_HOLD', 'DUTIES_DUE', 'CUSTOMS_RELEASED', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('PERSONAL', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "FreightMode" AS ENUM ('AIR', 'SEA', 'COURIER');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('UNCLASSIFIED', 'AI_SUGGESTED', 'NEEDS_REVIEW', 'BROKER_APPROVED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('COMMERCIAL_INVOICE', 'AIRWAY_BILL', 'BILL_OF_LADING', 'PACKING_LIST', 'PERMIT', 'RECEIPT', 'CUSTOMS_ENTRY', 'PROOF_OF_DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "DeclarationStatus" AS ENUM ('NOT_STARTED', 'PREPARED', 'SUBMITTED', 'QUERIED', 'ASSESSED', 'RELEASED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOIDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PricingScope" AS ENUM ('GLOBAL', 'PLAN', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('SUBMITTED', 'QUOTING', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('UNSCHEDULED', 'SCHEDULED', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'WAITING_CUSTOMER', 'WAITING_STAFF', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'TRIAL', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CONSUMER',
    "emailVerified" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nib" TEXT,
    "addressId" TEXT,
    "membershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "tin" TEXT,
    "importerNumber" TEXT,
    "industry" TEXT,
    "billingEmail" TEXT,
    "accountManagerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "subscriptionId" TEXT,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "settlement" TEXT NOT NULL,
    "island" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BS',
    "contact" TEXT,
    "phone" TEXT,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "website" TEXT,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT NOT NULL,
    "hsCodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HsCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HsCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payee" "Payee" NOT NULL,
    "basis" "ChargeBasis" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "baseIncludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateRule" (
    "id" TEXT NOT NULL,
    "chargeTypeId" TEXT NOT NULL,
    "hsCodeId" TEXT,
    "chapter" TEXT,
    "rate" DECIMAL(9,6) NOT NULL,
    "minAmount" DECIMAL(14,2),
    "maxAmount" DECIMAL(14,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "sourceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitRequirement" (
    "id" TEXT NOT NULL,
    "hsCodeId" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "permit" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermitRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "businessId" TEXT,
    "importType" "ImportType" NOT NULL DEFAULT 'PERSONAL',
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "freightMode" "FreightMode" NOT NULL DEFAULT 'AIR',
    "supplierId" TEXT,
    "trackingNumber" TEXT,
    "airwayBill" TEXT,
    "originCountry" TEXT,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fxRate" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "goodsValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "insuranceCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossWeightKg" DECIMAL(10,3),
    "estimateJson" JSONB,
    "estimatedAt" TIMESTAMP(3),
    "brokerApprovedAt" TIMESTAMP(3),
    "brokerApprovedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unitValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "originCountry" TEXT,
    "hsCodeId" TEXT,
    "suggestedHsCode" TEXT,
    "confidence" DECIMAL(4,3),
    "classificationStatus" "ClassificationStatus" NOT NULL DEFAULT 'UNCLASSIFIED',
    "brokerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentDocument" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ShipmentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentExtraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "extractedJson" JSONB NOT NULL,
    "userJson" JSONB,
    "staffJson" JSONB,
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentStatusHistory" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "from" "ShipmentStatus",
    "to" "ShipmentStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsDeclaration" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "DeclarationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "entryNumber" TEXT,
    "regimeCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "assessedTotal" DECIMAL(14,2),
    "releasedAt" TIMESTAMP(3),
    "payloadJson" JSONB,
    "adapter" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsCharge" (
    "id" TEXT NOT NULL,
    "shipmentItemId" TEXT,
    "quoteId" TEXT,
    "chargeTypeId" TEXT NOT NULL,
    "payee" "Payee" NOT NULL,
    "basisAmount" DECIMAL(14,2) NOT NULL,
    "rateApplied" DECIMAL(9,6) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "rateRuleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomsCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "customsValue" DECIMAL(14,2) NOT NULL,
    "governmentTotal" DECIMAL(14,2) NOT NULL,
    "brokerTotal" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "brokerApproved" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "shipmentId" TEXT,
    "quoteId" TEXT,
    "businessId" TEXT,
    "billToEmail" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "governmentTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "brokerTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payee" "Payee" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "chargeCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3),
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BSD',
    "features" TEXT[],
    "brokerageDiscount" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "deliveryDiscount" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "chargeCode" TEXT NOT NULL,
    "scope" "PricingScope" NOT NULL DEFAULT 'GLOBAL',
    "planCode" TEXT,
    "businessId" TEXT,
    "importType" "ImportType",
    "minValue" DECIMAL(14,2),
    "maxValue" DECIMAL(14,2),
    "flatAmount" DECIMAL(14,2),
    "percentRate" DECIMAL(9,6),
    "perLineAmount" DECIMAL(14,2),
    "minFee" DECIMAL(14,2),
    "maxFee" DECIMAL(14,2),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "productUrl" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "specifications" TEXT,
    "targetBudget" DECIMAL(14,2),
    "requiredBy" TIMESTAMP(3),
    "notes" TEXT,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementQuote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productCost" DECIMAL(14,2) NOT NULL,
    "domesticTransport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "internationalFreight" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "insurance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "governmentEstimate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "procurementFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "brokerageFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "preparedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicle" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'UNSCHEDULED',
    "scheduledFor" TIMESTAMP(3),
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "podStorageKey" TEXT,
    "signatureName" TEXT,
    "note" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionFlag" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "monthlyVolume" DECIMAL(14,2),
    "currentBroker" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'LEAD',
    "ownerId" TEXT,
    "nextFollowUp" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumerProfile_userId_key" ON "ConsumerProfile"("userId");

-- CreateIndex
CREATE INDEX "Business_legalName_idx" ON "Business"("legalName");

-- CreateIndex
CREATE INDEX "BusinessMember_userId_idx" ON "BusinessMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMember_businessId_userId_key" ON "BusinessMember"("businessId", "userId");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Product_businessId_idx" ON "Product"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "HsCode_code_key" ON "HsCode"("code");

-- CreateIndex
CREATE INDEX "HsCode_chapter_idx" ON "HsCode"("chapter");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeType_code_key" ON "ChargeType"("code");

-- CreateIndex
CREATE INDEX "RateRule_chargeTypeId_hsCodeId_idx" ON "RateRule"("chargeTypeId", "hsCodeId");

-- CreateIndex
CREATE INDEX "RateRule_chargeTypeId_chapter_idx" ON "RateRule"("chargeTypeId", "chapter");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_reference_key" ON "Shipment"("reference");

-- CreateIndex
CREATE INDEX "Shipment_ownerId_status_idx" ON "Shipment"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Shipment_businessId_status_idx" ON "Shipment"("businessId", "status");

-- CreateIndex
CREATE INDEX "Shipment_trackingNumber_idx" ON "Shipment"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_lineNumber_key" ON "ShipmentItem"("shipmentId", "lineNumber");

-- CreateIndex
CREATE INDEX "ShipmentDocument_shipmentId_idx" ON "ShipmentDocument"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentExtraction_documentId_key" ON "DocumentExtraction"("documentId");

-- CreateIndex
CREATE INDEX "ShipmentStatusHistory_shipmentId_createdAt_idx" ON "ShipmentStatusHistory"("shipmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsDeclaration_shipmentId_key" ON "CustomsDeclaration"("shipmentId");

-- CreateIndex
CREATE INDEX "CustomsCharge_quoteId_idx" ON "CustomsCharge"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_reference_key" ON "Quote"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");

-- CreateIndex
CREATE INDEX "Invoice_businessId_status_idx" ON "Invoice"("businessId", "status");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "PricingRule_chargeCode_scope_idx" ON "PricingRule"("chargeCode", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementRequest_reference_key" ON "ProcurementRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_shipmentId_key" ON "Delivery"("shipmentId");

-- CreateIndex
CREATE INDEX "Delivery_driverId_status_idx" ON "Delivery"("driverId", "status");

-- CreateIndex
CREATE INDEX "ExceptionFlag_shipmentId_resolvedAt_idx" ON "ExceptionFlag"("shipmentId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_reference_key" ON "SupportTicket"("reference");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumerProfile" ADD CONSTRAINT "ConsumerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumerProfile" ADD CONSTRAINT "ConsumerProfile_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumerProfile" ADD CONSTRAINT "ConsumerProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_hsCodeId_fkey" FOREIGN KEY ("hsCodeId") REFERENCES "HsCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRule" ADD CONSTRAINT "RateRule_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "ChargeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRule" ADD CONSTRAINT "RateRule_hsCodeId_fkey" FOREIGN KEY ("hsCodeId") REFERENCES "HsCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitRequirement" ADD CONSTRAINT "PermitRequirement_hsCodeId_fkey" FOREIGN KEY ("hsCodeId") REFERENCES "HsCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_hsCodeId_fkey" FOREIGN KEY ("hsCodeId") REFERENCES "HsCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentStatusHistory" ADD CONSTRAINT "ShipmentStatusHistory_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsDeclaration" ADD CONSTRAINT "CustomsDeclaration_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsCharge" ADD CONSTRAINT "CustomsCharge_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsCharge" ADD CONSTRAINT "CustomsCharge_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsCharge" ADD CONSTRAINT "CustomsCharge_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "ChargeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementQuote" ADD CONSTRAINT "ProcurementQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionFlag" ADD CONSTRAINT "ExceptionFlag_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
