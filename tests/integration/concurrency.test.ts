import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { money } from "@/lib/money";
import { issueInvoiceForQuote, recordPayment } from "@/lib/services/invoice-service";
import { issueQuote, transitionShipment } from "@/lib/services/shipment-service";
import { createShipment, createUser, resetDatabase, seedRates } from "../helpers/db";
import { quotedShipment } from "../helpers/flows";

beforeEach(resetDatabase);

async function quoted() {
  const { shirts } = await seedRates();
  const staff = await createUser("OPERATIONS");
  const owner = await createUser("CONSUMER");
  const { shipment, quote } = await quotedShipment({ ownerId: owner.id, staffId: staff.id, hsCodeId: shirts.id });
  return { staff, owner, shipment, quote };
}
const fulfilled = (results: PromiseSettledResult<unknown>[]) => results.filter((r) => r.status === "fulfilled").length;

describe("double-submits and races", () => {
  it("invoices a quote once, however many requests arrive together", async () => {
    const { staff, quote } = await quoted();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => issueInvoiceForQuote(quote.id, staff.id)),
    );
    expect(fulfilled(results)).toBe(1);
    expect(await db.invoice.count({ where: { quoteId: quote.id } })).toBe(1);
    await expect(issueInvoiceForQuote(quote.id, staff.id)).rejects.toThrow(/already been invoiced/);
  });

  it("applies every one of several concurrent part-payments", async () => {
    const { staff, quote } = await quoted();
    const invoice = await issueInvoiceForQuote(quote.id, staff.id);
    const parts = 4;
    const share = money(invoice.total).dividedBy(parts).toDecimalPlaces(2, 1);
    const last = money(invoice.total).minus(share.times(parts - 1));
    const amounts = [...Array(parts - 1).fill(share.toFixed(2)), last.toFixed(2)];

    await Promise.all(amounts.map((amount) => recordPayment({ invoiceId: invoice.id, amount, provider: "manual", actorId: staff.id })));

    const after = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.amountPaid.toFixed(2)).toBe(invoice.total.toFixed(2));
    expect(after.status).toBe("PAID");
    expect(await db.payment.count({ where: { invoiceId: invoice.id } })).toBe(parts);
  });

  it("leaves exactly one live quote when re-quotes race", async () => {
    const { staff, shipment } = await quoted();
    // A race test can only make the overlap likely, not certain; more contenders
    // make it very likely. Without the lock this fails on nearly every run.
    await Promise.all(Array.from({ length: 8 }, () => issueQuote(shipment.id, staff.id)));
    expect(await db.quote.count({ where: { shipmentId: shipment.id, status: "ISSUED" } })).toBe(1);
    expect(await db.quote.count({ where: { shipmentId: shipment.id } })).toBe(9);
  });

  it("applies only one of two status changes made from the same starting point", async () => {
    const staff = await createUser("OPERATIONS");
    const owner = await createUser("CONSUMER");
    const shipment = await createShipment({ ownerId: owner.id, lines: [{ lineValue: "10.00" }] });

    const results = await Promise.allSettled([
      transitionShipment({ shipmentId: shipment.id, to: "CANCELLED", actorId: staff.id }),
      transitionShipment({ shipmentId: shipment.id, to: "DOCUMENTS_REQUIRED", actorId: staff.id }),
    ]);

    expect(fulfilled(results)).toBe(1);
    expect(await db.shipmentStatusHistory.count({ where: { shipmentId: shipment.id, from: "DRAFT" } })).toBe(1);
  });
});
