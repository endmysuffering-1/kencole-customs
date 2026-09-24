import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordPayment } from "@/lib/services/invoice-service";
import { transitionShipment } from "@/lib/services/shipment-service";
import { createInvoice, createShipment, createUser, resetDatabase, seedRates } from "../helpers/db";

beforeEach(resetDatabase);

async function setup() {
  const { shirts } = await seedRates();
  const staff = await createUser("CUSTOMS_BROKER");
  const owner = await createUser("CONSUMER");
  return { shirts, staff, owner };
}
const historyTo = (shipmentId: string, to: string) =>
  db.shipmentStatusHistory.count({ where: { shipmentId, to: to as never } });

describe("no SUBMITTED_TO_CUSTOMS without every line BROKER_APPROVED", () => {
  it.each(["NEEDS_REVIEW", "AI_SUGGESTED", "UNCLASSIFIED", "EXCEPTION"] as const)(
    "refuses while one line is %s, and leaves no trace",
    async (status) => {
      const { shirts, staff, owner } = await setup();
      const shipment = await createShipment({
        ownerId: owner.id, status: "DECLARATION_PREPARED", commercialInvoice: true,
        lines: [{ lineValue: "100.00", hsCodeId: shirts.id }, { lineValue: "50.00", hsCodeId: shirts.id, status }],
      });

      await expect(
        transitionShipment({ shipmentId: shipment.id, to: "SUBMITTED_TO_CUSTOMS", actorId: staff.id }),
      ).rejects.toThrow(/broker must approve/);

      expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("DECLARATION_PREPARED");
      expect(await historyTo(shipment.id, "SUBMITTED_TO_CUSTOMS")).toBe(0);
    },
  );

  it("refuses to prepare the declaration either", async () => {
    const { shirts, staff, owner } = await setup();
    const shipment = await createShipment({
      ownerId: owner.id, status: "PAID", commercialInvoice: true,
      lines: [{ lineValue: "100.00", hsCodeId: shirts.id, status: "AI_SUGGESTED" }],
    });
    await expect(
      transitionShipment({ shipmentId: shipment.id, to: "DECLARATION_PREPARED", actorId: staff.id }),
    ).rejects.toThrow(/awaiting broker approval/);
  });

  it("submits once every line is approved", async () => {
    const { shirts, staff, owner } = await setup();
    const shipment = await createShipment({
      ownerId: owner.id, status: "DECLARATION_PREPARED", commercialInvoice: true,
      lines: [{ lineValue: "100.00", hsCodeId: shirts.id }, { lineValue: "50.00", hsCodeId: shirts.id }],
    });
    await transitionShipment({ shipmentId: shipment.id, to: "SUBMITTED_TO_CUSTOMS", actorId: staff.id });
    expect(await historyTo(shipment.id, "SUBMITTED_TO_CUSTOMS")).toBe(1);
  });
});

describe("no PAID without a settled invoice", () => {
  async function awaitingPayment() {
    const s = await setup();
    const shipment = await createShipment({
      ownerId: s.owner.id, status: "AWAITING_PAYMENT", commercialInvoice: true,
      lines: [{ lineValue: "100.00", hsCodeId: s.shirts.id }],
    });
    return { ...s, shipment };
  }
  const tryPaid = (shipmentId: string, actorId: string) =>
    transitionShipment({ shipmentId, to: "PAID", actorId });

  it("refuses with no invoice at all", async () => {
    const { shipment, staff } = await awaitingPayment();
    await expect(tryPaid(shipment.id, staff.id)).rejects.toThrow(/not been settled/);
  });

  it("refuses with an unpaid invoice", async () => {
    const { shipment, staff } = await awaitingPayment();
    await createInvoice({ shipmentId: shipment.id, governmentTotal: "40.00", brokerTotal: "20.00" });
    await expect(tryPaid(shipment.id, staff.id)).rejects.toThrow(/not been settled/);
  });

  it("refuses on a part-payment", async () => {
    const { shipment, staff } = await awaitingPayment();
    await createInvoice({ shipmentId: shipment.id, governmentTotal: "40.00", brokerTotal: "20.00", status: "PARTIALLY_PAID", amountPaid: "59.99" });
    await expect(tryPaid(shipment.id, staff.id)).rejects.toThrow(/not been settled/);
  });

  it.each(["VOIDED", "REFUNDED"] as const)("does not count a %s invoice as settled, however much it shows paid", async (status) => {
    const { shipment, staff } = await awaitingPayment();
    await createInvoice({ shipmentId: shipment.id, governmentTotal: "40.00", brokerTotal: "20.00", status, amountPaid: "60.00" });
    await expect(tryPaid(shipment.id, staff.id)).rejects.toThrow(/not been settled/);
    expect(await historyTo(shipment.id, "PAID")).toBe(0);
  });

  it("allows PAID once a recorded payment settles the invoice", async () => {
    const { shipment, staff } = await awaitingPayment();
    const invoice = await createInvoice({ shipmentId: shipment.id, governmentTotal: "40.00", brokerTotal: "20.00" });
    await recordPayment({ invoiceId: invoice.id, amount: "60.00", provider: "manual", actorId: staff.id });
    await tryPaid(shipment.id, staff.id);
    expect(await historyTo(shipment.id, "PAID")).toBe(1);
  });
});
