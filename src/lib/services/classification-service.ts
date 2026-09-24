import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import {
  rankSuggestions,
  statusForSuggestion,
  suggestFromHistory,
  suggestFromKeywords,
  KEYWORD_RULES,
  type Suggestion,
} from "@/lib/domain/classification";
import { DomainError } from "./errors";

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

  // Approving a different code from the one on the table is a change, whatever
  // the decision is called — otherwise APPROVE is a way round the reason.
  const proposed = item.hsCode?.code ?? item.suggestedHsCode;
  const departs =
    input.decision !== "APPROVE" || (proposed != null && proposed !== code.code);
  const reason = input.reason?.trim();

  // Checked before anything is written. The reason is the broker's own words;
  // this function never supplies one on their behalf.
  if (departs && !reason) {
    throw new DomainError("Give a reason when changing or flagging a classification.");
  }

  const status =
    input.decision === "EXCEPTION" ? "EXCEPTION" : ("BROKER_APPROVED" as const);

  return db.$transaction(async (tx) => {
    const updated = await tx.shipmentItem.update({
      where: { id: input.itemId },
      data: {
        hsCodeId: code.id,
        classificationStatus: status,
        brokerNote: input.note ?? null,
      },
    });

    await recordAudit(
      {
        actorId: input.brokerId,
        action: departs ? "classification.changed" : "classification.approved",
        entityType: "ShipmentItem",
        entityId: item.id,
        oldValue: {
          hsCode: item.hsCode?.code ?? null,
          suggested: item.suggestedHsCode,
          status: item.classificationStatus,
        },
        newValue: { hsCode: code.code, status },
        reason: reason || undefined,
      },
      tx,
    );

    return updated;
  });
}
