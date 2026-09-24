import { issueQuote, transitionShipment } from "@/lib/services/shipment-service";
import { createShipment } from "./db";

/** A shipment with approved lines and a commercial invoice, walked to QUOTE_READY
 *  and quoted through the real services. */
export async function quotedShipment(input: {
  ownerId: string;
  staffId: string;
  businessId?: string | null;
  hsCodeId: string;
  lineValues?: string[];
}) {
  const shipment = await createShipment({
    ownerId: input.ownerId,
    businessId: input.businessId,
    commercialInvoice: true,
    lines: (input.lineValues ?? ["600.00", "400.00"]).map((lineValue) => ({ lineValue, hsCodeId: input.hsCodeId })),
  });
  for (const to of ["DOCUMENTS_RECEIVED", "UNDER_REVIEW", "QUOTE_READY"] as const) {
    await transitionShipment({ shipmentId: shipment.id, to, actorId: input.staffId });
  }
  const quote = await issueQuote(shipment.id, input.staffId);
  return { shipment, quote };
}
