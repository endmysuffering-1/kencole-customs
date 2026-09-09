import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import {
  rankSuggestions,
  statusForSuggestion,
  suggestFromHistory,
  suggestFromKeywords,
  type KeywordRule,
  type Suggestion,
} from "@/lib/domain/classification";
import { DomainError } from "./shipment-service";

/** Broad first-pass rules. The real precision comes from broker history below. */
const KEYWORD_RULES: KeywordRule[] = [
  { hsCode: "8471.30.00", description: "Portable computers", keywords: ["laptop", "notebook computer", "macbook"] },
  { hsCode: "8517.13.00", description: "Smartphones", keywords: ["smartphone", "iphone", "mobile phone", "android phone"] },
  { hsCode: "6109.10.00", description: "T-shirts, cotton, knitted", keywords: ["t-shirt", "tee shirt", "cotton shirt"] },
  { hsCode: "9403.20.00", description: "Other metal furniture", keywords: ["shelving", "metal rack", "office furniture"] },
  { hsCode: "8708.99.00", description: "Motor vehicle parts", keywords: ["brake pad", "car part", "vehicle part", "alternator"] },
  { hsCode: "2208.40.00", description: "Rum and other spirits from cane", keywords: ["rum", "spirits"], alwaysReview: true },
  { hsCode: "3004.90.00", description: "Medicaments, packaged", keywords: ["medicine", "pharmaceutical", "prescription"], alwaysReview: true },
  { hsCode: "0303.00.00", description: "Fish, frozen", keywords: ["frozen fish", "seafood"], alwaysReview: true },
];

export async function suggestForItem(itemId: string): Promise<Suggestion[]> {
  const item = await db.shipmentItem.findUnique({
    where: { id: itemId },
    include: { shipment: { select: { supplierId: true, businessId: true } } },
  });
  if (!item) throw new DomainError("Item not found.", 404);

  const approved = await db.shipmentItem.findMany({
    where: {
      classificationStatus: "BROKER_APPROVED",
      hsCodeId: { not: null },
      shipment: item.shipment.businessId
        ? { businessId: item.shipment.businessId }
        : { supplierId: item.shipment.supplierId },
    },
    include: { hsCode: true, shipment: { select: { supplierId: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const history = approved
    .filter((a) => a.hsCode)
    .map((a) => ({
      hsCode: a.hsCode!.code,
      description: a.hsCode!.description,
      itemDescription: a.description,
      supplierId: a.shipment.supplierId,
      approvedAt: a.updatedAt,
    }));

  const suggestions = rankSuggestions([
    suggestFromHistory(item.description, item.shipment.supplierId, history),
    suggestFromKeywords(item.description, KEYWORD_RULES),
  ]);

  const top = suggestions[0];
  if (top && item.classificationStatus === "UNCLASSIFIED") {
    await db.shipmentItem.update({
      where: { id: itemId },
      data: {
        suggestedHsCode: top.hsCode,
        confidence: top.confidence,
        classificationStatus: statusForSuggestion(top),
      },
    });
    await recordAudit({
      action: "classification.suggested",
      entityType: "ShipmentItem",
      entityId: itemId,
      newValue: { hsCode: top.hsCode, confidence: top.confidence, source: top.source },
    });
  }

  return suggestions;
}

/**
 * A broker's decision. This is the regulated checkpoint: only a user holding
 * classification:approve reaches this function, and any departure from the
 * suggestion requires a written reason that lands in the audit log.
 */
export async function decideClassification(input: {
  itemId: string;
  hsCode: string;
  decision: "APPROVE" | "MODIFY" | "EXCEPTION";
  reason?: string;
  note?: string;
  brokerId: string;
}) {
  const item = await db.shipmentItem.findUnique({
    where: { id: input.itemId },
    include: { hsCode: true },
  });
  if (!item) throw new DomainError("Item not found.", 404);

  const code = await db.hsCode.findUnique({ where: { code: input.hsCode } });
  if (!code) throw new DomainError(`Tariff code ${input.hsCode} is not in the classification table.`);

  const status =
    input.decision === "EXCEPTION" ? "EXCEPTION" : ("BROKER_APPROVED" as const);

  const updated = await db.shipmentItem.update({
    where: { id: input.itemId },
    data: {
      hsCodeId: code.id,
      classificationStatus: status,
      brokerNote: input.note ?? null,
    },
  });

  await recordAudit({
    actorId: input.brokerId,
    action: input.decision === "APPROVE" ? "classification.approved" : "classification.changed",
    entityType: "ShipmentItem",
    entityId: item.id,
    oldValue: { hsCode: item.hsCode?.code ?? null, status: item.classificationStatus },
    newValue: { hsCode: code.code, status },
    reason: input.decision === "APPROVE" ? input.reason : (input.reason ?? "Broker override"),
  });

  return updated;
}
