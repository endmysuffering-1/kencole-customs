import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordPaymentAndAdvance } from "@/lib/services/billing-flow";
import { readDocument, uploadDocument } from "@/lib/services/document-service";
import { storage } from "@/lib/providers/storage";
import { findShipmentByReference, getInvoice, getShipment, listInvoices, listShipments } from "@/lib/services/shipment-queries";
import {
  acceptQuote,
  openShipment,
  quickEstimate,
  requestTransition,
  updateShipment,
} from "@/lib/services/shipment-service";
import { shipmentSchema, estimateSchema } from "@/lib/validation/schemas";
import {
  createBusiness,
  createInvoice,
  createShipment,
  createUser,
  principalOf,
  resetDatabase,
  seedRates,
} from "../helpers/db";
import { quotedShipment } from "../helpers/flows";

beforeEach(resetDatabase);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const shipmentInput = (extra: Record<string, unknown> = {}) =>
  shipmentSchema.parse({
    goodsValue: "100.00",
    heldAt: "Air cargo, Lynden Pindling International Airport",
    items: [{ description: "Cotton t-shirts", quantity: "10", unitValue: "10.00" }],
    ...extra,
  });

async function world() {
  const { shirts, rum } = await seedRates();
  const [consumerA, consumerB, importerA, importerB, ops, broker] = await Promise.all([
    createUser("CONSUMER", "consumer-a"), createUser("CONSUMER", "consumer-b"),
    createUser("BUSINESS_USER", "importer-a"), createUser("BUSINESS_USER", "importer-b"),
    createUser("OPERATIONS"), createUser("CUSTOMS_BROKER"),
  ]);
  const businessA = await createBusiness([{ userId: importerA.id }]);
  const businessB = await createBusiness([{ userId: importerB.id }]);
  const p = {
    consumerA: await principalOf(consumerA.id), consumerB: await principalOf(consumerB.id),
    importerA: await principalOf(importerA.id), importerB: await principalOf(importerB.id),
    ops: await principalOf(ops.id), broker: await principalOf(broker.id),
  };
  return { shirts, rum, businessA, businessB, p };
}

describe("listing and reading are scoped to the person asking", () => {
  it("lists only a person's own shipments and their business's", async () => {
    const { p, businessA, businessB } = await world();
    const a = await createShipment({ ownerId: p.consumerA.id, lines: [{ lineValue: "1.00" }] });
    const b = await createShipment({ ownerId: p.consumerB.id, lines: [{ lineValue: "1.00" }] });
    const bizA = await createShipment({ ownerId: p.importerA.id, businessId: businessA.id, lines: [{ lineValue: "1.00" }] });
    const bizB = await createShipment({ ownerId: p.importerB.id, businessId: businessB.id, lines: [{ lineValue: "1.00" }] });

    const ids = async (who: typeof p.consumerA) => (await listShipments(who)).shipments.map((s) => s.id).sort();
    expect(await ids(p.consumerA)).toEqual([a.id]);
    expect(await ids(p.importerA)).toEqual([bizA.id]);
    expect(await ids(p.ops)).toEqual([a.id, b.id, bizA.id, bizB.id].sort());
  });

  it("answers 404, not 403, for someone else's shipment or invoice", async () => {
    const { p } = await world();
    const b = await createShipment({ ownerId: p.consumerB.id, lines: [{ lineValue: "1.00" }] });
    const invoice = await createInvoice({ shipmentId: b.id, governmentTotal: "1.00", brokerTotal: "1.00" });

    await expect(getShipment(p.consumerA, b.id)).rejects.toMatchObject({ status: 404 });
    await expect(getInvoice(p.consumerA, invoice.id)).rejects.toMatchObject({ status: 404 });
    expect((await listInvoices(p.consumerA)).length).toBe(0);
    expect((await listInvoices(p.consumerB)).map((i) => i.id)).toEqual([invoice.id]);
  });

  it("shows a customer no machine suggestions, exceptions, internal notes or internal status names", async () => {
    const { p } = await world();
    const s = await createShipment({ ownerId: p.consumerA.id, lines: [{ lineValue: "5.00", status: "NEEDS_REVIEW" }] });
    await db.shipmentItem.updateMany({ where: { shipmentId: s.id }, data: { suggestedHsCode: "6109.10.00", brokerNote: "internal" } });
    await db.shipmentStatusHistory.create({ data: { shipmentId: s.id, to: "DRAFT", note: "Risk score high", actorId: p.ops.id } });
    await db.exceptionFlag.create({ data: { shipmentId: s.id, code: "X", severity: "WARNING", message: "internal" } });

    const view = await getShipment(p.consumerA, s.id);
    const json = JSON.stringify(view);
    expect(json).not.toContain("6109.10.00");
    expect(json).not.toContain("internal");
    expect(json).not.toContain("Risk score high");
    expect(view.exceptions).toBeUndefined();
    expect(view.statusLabel).toBe("Not submitted yet");

    const staffView = await getShipment(p.ops, s.id);
    expect(staffView.exceptions).toHaveLength(1);
    expect(staffView.statusLabel).toBe("Draft");
  });

  it("marks every quoted government charge from an unconfirmed rate as unverified", async () => {
    const { p, shirts } = await world();
    const { shipment } = await quotedShipment({ ownerId: p.consumerA.id, staffId: p.ops.id, hsCodeId: shirts.id });
    const view = await getShipment(p.consumerA, shipment.id);
    const charges = view.quotes[0]!.charges;
    expect(charges.filter((c) => c.payee === "GOVERNMENT").every((c) => c.unverified)).toBe(true);
    expect(charges.filter((c) => c.payee === "BROKER").every((c) => !c.unverified)).toBe(true);

    await db.rateRule.updateMany({ data: { confirmed: true, sourceNote: "Test instrument" } });
    const confirmed = await getShipment(p.consumerA, shipment.id);
    expect(confirmed.quotes[0]!.charges.some((c) => c.unverified)).toBe(false);
  });
});

describe("opening and changing a shipment", () => {
  it("files under the member's own business, never under someone else's", async () => {
    const { p, businessA, businessB } = await world();
    const own = await openShipment({ principal: p.importerA, data: shipmentInput() });
    expect(own.businessId).toBe(businessA.id);
    expect(own.importType).toBe("COMMERCIAL");
    await expect(openShipment({ principal: p.importerA, data: { ...shipmentInput(), businessId: businessB.id } }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("refuses a currency it cannot convert rather than guessing a rate", async () => {
    const { p } = await world();
    await expect(openShipment({ principal: p.consumerA, data: shipmentInput({ currency: "EUR" }) })).rejects.toThrow(/USD or BSD/);
  });

  it("lets a customer edit until review starts, and not after", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    await updateShipment({ principal: p.consumerA, shipmentId: s.id, data: { description: "Updated" } });
    await db.shipment.update({ where: { id: s.id }, data: { status: "UNDER_REVIEW" } });
    await expect(updateShipment({ principal: p.consumerA, shipmentId: s.id, data: { description: "Again" } }))
      .rejects.toMatchObject({ status: 409 });
    await expect(updateShipment({ principal: p.consumerB, shipmentId: s.id, data: { description: "Mine now" } }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("makes staff give a reason for a value change mid-flight, and withdraws the stale quote", async () => {
    const { p, shirts } = await world();
    const { shipment, quote } = await quotedShipment({ ownerId: p.consumerA.id, staffId: p.ops.id, hsCodeId: shirts.id });

    await expect(updateShipment({ principal: p.ops, shipmentId: shipment.id, data: { freightCost: "50.00" } }))
      .rejects.toThrow(/reason/);
    await updateShipment({ principal: p.ops, shipmentId: shipment.id, data: { freightCost: "50.00", reason: "Carrier re-rated" } });

    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SUPERSEDED");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "shipment.value_changed" } });
    expect(log.reason).toBe("Carrier re-rated");
  });

  it("re-opens classification when the lines are replaced", async () => {
    const { p, shirts } = await world();
    const s = await createShipment({ ownerId: p.consumerA.id, status: "CLASSIFICATION_REVIEW", lines: [{ lineValue: "5.00", hsCodeId: shirts.id }] });
    await updateShipment({
      principal: p.ops, shipmentId: s.id,
      data: { items: shipmentInput().items, reason: "Supplier sent a corrected invoice" },
    });
    const items = await db.shipmentItem.findMany({ where: { shipmentId: s.id } });
    expect(items.every((i) => i.classificationStatus === "UNCLASSIFIED" && i.hsCodeId === null)).toBe(true);
  });
});

describe("status changes by role", () => {
  it("lets a customer withdraw their own shipment early, and do nothing else", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    await expect(requestTransition({ principal: p.consumerA, shipmentId: s.id, to: "DOCUMENTS_REQUIRED" })).rejects.toMatchObject({ status: 403 });
    await expect(requestTransition({ principal: p.consumerB, shipmentId: s.id, to: "CANCELLED" })).rejects.toMatchObject({ status: 404 });
    await requestTransition({ principal: p.consumerA, shipmentId: s.id, to: "CANCELLED" });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CANCELLED");
  });

  it("keeps submission to customs with the licensed broker, even with every line approved", async () => {
    const { p, shirts } = await world();
    const s = await createShipment({
      ownerId: p.consumerA.id, status: "DECLARATION_PREPARED", commercialInvoice: true,
      lines: [{ lineValue: "5.00", hsCodeId: shirts.id }],
    });
    await expect(requestTransition({ principal: p.ops, shipmentId: s.id, to: "SUBMITTED_TO_CUSTOMS" }))
      .rejects.toThrow(/licensed customs broker/);
    await requestTransition({ principal: p.broker, shipmentId: s.id, to: "SUBMITTED_TO_CUSTOMS" });
  });
});

describe("accepting a quote", () => {
  it("accepts, moves to AWAITING_PAYMENT and invoices, all at once", async () => {
    const { p, shirts } = await world();
    const { shipment, quote } = await quotedShipment({ ownerId: p.consumerA.id, staffId: p.ops.id, hsCodeId: shirts.id });

    const invoice = await acceptQuote({ principal: p.consumerA, quoteId: quote.id });

    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("ACCEPTED");
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("AWAITING_PAYMENT");
    expect(invoice.governmentTotal.toFixed(2)).toBe(quote.governmentTotal.toFixed(2));
    expect(invoice.brokerTotal.toFixed(2)).toBe(quote.brokerTotal.toFixed(2));
    await expect(acceptQuote({ principal: p.consumerA, quoteId: quote.id })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a quote no broker has reviewed, and changes nothing", async () => {
    const { p, shirts } = await world();
    const { shipment, quote } = await quotedShipment({ ownerId: p.consumerA.id, staffId: p.ops.id, hsCodeId: shirts.id });
    await db.quote.update({ where: { id: quote.id }, data: { brokerApproved: false } });

    await expect(acceptQuote({ principal: p.consumerA, quoteId: quote.id })).rejects.toThrow(/licensed broker/);
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("QUOTE_READY");
    expect(await db.invoice.count()).toBe(0);
  });

  it("refuses an expired quote, and another customer's quote", async () => {
    const { p, shirts } = await world();
    const { quote } = await quotedShipment({ ownerId: p.consumerA.id, staffId: p.ops.id, hsCodeId: shirts.id });
    await expect(acceptQuote({ principal: p.consumerB, quoteId: quote.id })).rejects.toMatchObject({ status: 404 });
    await db.quote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptQuote({ principal: p.consumerA, quoteId: quote.id })).rejects.toThrow(/expired/);
  });

  it("moves the shipment to PAID when a recorded payment settles it", async () => {
    const { p, shirts } = await world();
    const { shipment, quote } = await quotedShipment({ ownerId: p.consumerA.id, staffId: p.ops.id, hsCodeId: shirts.id });
    const invoice = await acceptQuote({ principal: p.consumerA, quoteId: quote.id });

    await recordPaymentAndAdvance({ invoiceId: invoice.id, amount: "1.00", provider: "manual", actorId: p.ops.id });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("AWAITING_PAYMENT");

    const rest = invoice.total.minus(1).toFixed(2);
    await recordPaymentAndAdvance({ invoiceId: invoice.id, amount: rest, provider: "manual", actorId: p.ops.id });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("PAID");
  });
});

describe("documents", () => {
  it("stores a commercial invoice and moves the shipment to documents received", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    const doc = await uploadDocument({
      principal: p.consumerA, shipmentId: s.id, kind: "COMMERCIAL_INVOICE",
      file: { name: "invoice.pdf", type: "application/pdf", body: PDF },
    });

    expect((await db.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("DOCUMENTS_RECEIVED");
    const read = await readDocument(p.consumerA, doc.id);
    expect(read.body.equals(PDF)).toBe(true);
    await expect(readDocument(p.consumerB, doc.id)).rejects.toMatchObject({ status: 404 });
    expect(await db.documentExtraction.count({ where: { documentId: doc.id } })).toBe(1);
  });

  it("rejects a file whose contents do not match its declared type", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    await expect(uploadDocument({
      principal: p.consumerA, shipmentId: s.id, kind: "COMMERCIAL_INVOICE",
      file: { name: "invoice.pdf", type: "application/pdf", body: Buffer.from("<html><script>alert(1)</script>") },
    })).rejects.toThrow(/do not match/);
    expect(await db.shipmentDocument.count()).toBe(0);
  });

  it("answers 404, not a server error, when a document's file has gone from storage", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    const doc = await uploadDocument({
      principal: p.consumerA, shipmentId: s.id, kind: "OTHER",
      file: { name: "x.pdf", type: "application/pdf", body: PDF },
    });
    await storage.remove(doc.storageKey);
    await expect(readDocument(p.consumerA, doc.id)).rejects.toMatchObject({ status: 404, message: /missing from storage/ });
  });

  it("will not attach a document to someone else's shipment", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    await expect(uploadDocument({
      principal: p.consumerB, shipmentId: s.id, kind: "OTHER",
      file: { name: "x.pdf", type: "application/pdf", body: PDF },
    })).rejects.toMatchObject({ status: 404 });
  });
});

describe("the public estimate", () => {
  it("prices a recognised heading on its own rate and flags every unconfirmed charge", async () => {
    await world();
    const est = await quickEstimate(estimateSchema.parse({ goodsValue: "1000", freightCost: "100", hsCode: "2208.40.00" }));
    expect(est.hsCodeRecognised).toBe(true);
    const duty = est.charges.find((c) => c.chargeCode === "IMPORT_DUTY")!;
    expect(duty.amount).toBe("550.00"); // the test book's 50% rum rule on 1100 CIF
    expect(est.unverifiedCharges).toEqual(expect.arrayContaining(["IMPORT_DUTY", "VAT"]));
    expect(est.charges.filter((c) => c.payee === "BROKER").length).toBeGreaterThan(0);
  });

  it("says when it does not know a heading and falls back to the general rate", async () => {
    await world();
    const est = await quickEstimate(estimateSchema.parse({ goodsValue: "1000", hsCode: "9999.99.99" }));
    expect(est.hsCodeRecognised).toBe(false);
    expect(est.unclassifiedLines).toEqual([1]);
  });

  it("refuses a currency it cannot convert", async () => {
    await expect(quickEstimate(estimateSchema.parse({ goodsValue: "10", currency: "GBP" }))).rejects.toThrow(/USD or BSD/);
  });

  it("quotes delivery only to someone who asks for it", async () => {
    await world();
    const codes = async (deliveryRequested?: boolean) =>
      (await quickEstimate(estimateSchema.parse({ goodsValue: "100", deliveryRequested }))).charges.map((c) => c.chargeCode);
    expect(await codes()).not.toContain("DELIVERY");
    expect(await codes(false)).not.toContain("DELIVERY");
    expect(await codes(true)).toContain("DELIVERY");
  });
});

describe("goods already in The Bahamas", () => {
  it("will not open a shipment without saying where the goods are waiting", () => {
    expect(() => shipmentInput({ heldAt: undefined })).toThrow(/where the goods are waiting/);
    expect(() => shipmentInput({ heldAt: " " })).toThrow(/where the goods are waiting/);
  });

  it("keeps where the goods are and prices delivery only when the customer asks", async () => {
    const { p } = await world();
    const collect = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    const deliver = await openShipment({ principal: p.consumerA, data: shipmentInput({ deliveryRequested: true }) });
    const codes = async (id: string) => {
      const s = await db.shipment.findUniqueOrThrow({ where: { id } });
      return (s.estimateJson as unknown as { charges: { chargeCode: string }[] }).charges.map((c) => c.chargeCode);
    };
    expect(collect.heldAt).toBe("Air cargo, Lynden Pindling International Airport");
    expect(await codes(collect.id)).not.toContain("DELIVERY");
    expect(await codes(deliver.id)).toContain("DELIVERY");
  });

  it("tells a collecting customer their goods are collected, not delivered", async () => {
    const { p } = await world();
    const s = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    await db.shipment.update({ where: { id: s.id }, data: { status: "DELIVERED" } });
    const view = await getShipment(p.consumerA, s.id);
    expect(view.statusLabel).toBe("Collected");
    expect(view.milestones.at(-1)?.label).toBe("Collected");
    await db.shipment.update({ where: { id: s.id }, data: { deliveryRequested: true } });
    expect((await getShipment(p.consumerA, s.id)).statusLabel).toBe("Delivered");
  });
});

describe("searching by shipment reference", () => {
  it("finds your own shipment, whatever the case, and never someone else's", async () => {
    const { p } = await world();
    const mine = await openShipment({ principal: p.consumerA, data: shipmentInput() });
    expect((await findShipmentByReference(p.consumerA, mine.reference.toLowerCase()))?.id).toBe(mine.id);
    expect(await findShipmentByReference(p.consumerB, mine.reference)).toBeNull();
    expect((await findShipmentByReference(p.ops, ` ${mine.reference} `))?.id).toBe(mine.id);
  });
});
