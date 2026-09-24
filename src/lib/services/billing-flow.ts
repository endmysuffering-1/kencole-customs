import { db } from "@/lib/db";
import { recordPayment } from "./invoice-service";
import { transitionShipment } from "./shipment-service";

/**
 * Records a payment and, if it settles the invoice while the shipment is waiting
 * on it, moves the shipment to PAID. The PAID guard still runs: the move happens
 * only because the invoice really is settled.
 */
export async function recordPaymentAndAdvance(input: Parameters<typeof recordPayment>[0]) {
  const payment = await recordPayment(input);
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    include: { shipment: { select: { id: true, status: true } } },
  });
  if (invoice.status === "PAID" && invoice.shipment?.status === "AWAITING_PAYMENT") {
    await transitionShipment({
      shipmentId: invoice.shipment.id, to: "PAID", actorId: input.actorId, note: `Payment on ${invoice.reference}`,
    });
  }
  return payment;
}
