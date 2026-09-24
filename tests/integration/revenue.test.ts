import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { money } from "@/lib/money";
import { issueInvoiceForQuote, revenueBetween } from "@/lib/services/invoice-service";
import { createInvoice, createUser, resetDatabase, seedRates } from "../helpers/db";
import { quotedShipment } from "../helpers/flows";

const FROM = new Date("2026-01-01T00:00:00Z");
const TO = new Date("2026-12-31T23:59:59Z");
const IN_WINDOW = new Date("2026-06-15T12:00:00Z");
const revenue = () => revenueBetween(FROM, TO);

beforeEach(resetDatabase);

describe("revenue separation: revenueBetween() never counts government money", () => {
  it("reports only Kencole's fees as revenue", async () => {
    await createInvoice({ governmentTotal: "5000.00", brokerTotal: "120.00", issuedAt: IN_WINDOW });
    await createInvoice({ governmentTotal: "800.50", brokerTotal: "45.25", issuedAt: IN_WINDOW });

    const r = await revenue();
    expect(r.brokerRevenue).toBe("165.25");
    expect(r.governmentCollected).toBe("5800.50");
  });

  it("does not move when the government money on an invoice changes", async () => {
    const invoice = await createInvoice({ governmentTotal: "100.00", brokerTotal: "30.00", issuedAt: IN_WINDOW });
    const before = await revenue();

    await db.invoice.update({ where: { id: invoice.id }, data: { governmentTotal: "999999.99" } });
    const after = await revenue();

    expect(after.brokerRevenue).toBe(before.brokerRevenue);
    expect(after.governmentCollected).toBe("999999.99");
  });

  it("reports nothing for an invoice that is all disbursement", async () => {
    await createInvoice({ governmentTotal: "750.00", brokerTotal: "0.00", issuedAt: IN_WINDOW });
    expect((await revenue()).brokerRevenue).toBe("0.00");
  });

  it("excludes draft, voided and refunded invoices", async () => {
    for (const status of ["DRAFT", "VOIDED", "REFUNDED"] as const) {
      await createInvoice({ governmentTotal: "100.00", brokerTotal: "10.00", status, issuedAt: IN_WINDOW });
    }
    await createInvoice({ governmentTotal: "100.00", brokerTotal: "7.00", issuedAt: IN_WINDOW });

    const r = await revenue();
    expect(r.brokerRevenue).toBe("7.00");
    expect(r.invoiceCount).toBe(1);
  });

  it("counts only invoices issued inside the period", async () => {
    await createInvoice({ governmentTotal: "0", brokerTotal: "11.00", issuedAt: new Date("2025-12-31T23:00:00Z") });
    await createInvoice({ governmentTotal: "0", brokerTotal: "22.00", issuedAt: IN_WINDOW });
    await createInvoice({ governmentTotal: "0", brokerTotal: "33.00", issuedAt: new Date("2027-01-01T01:00:00Z") });
    expect((await revenue()).brokerRevenue).toBe("22.00");
  });

  it("keeps the split intact from quote to invoice to report", async () => {
    const { shirts } = await seedRates();
    const staff = await createUser("OPERATIONS");
    const owner = await createUser("CONSUMER");
    const { quote } = await quotedShipment({ ownerId: owner.id, staffId: staff.id, hsCodeId: shirts.id });

    const invoice = await issueInvoiceForQuote(quote.id, staff.id);
    const sumOf = (payee: "GOVERNMENT" | "BROKER") =>
      invoice.lines.filter((l) => l.payee === payee).reduce((acc, l) => acc.plus(money(l.amount)), money(0)).toFixed(2);

    expect(invoice.governmentTotal.toFixed(2)).toBe(quote.governmentTotal.toFixed(2));
    expect(invoice.brokerTotal.toFixed(2)).toBe(quote.brokerTotal.toFixed(2));
    expect(sumOf("GOVERNMENT")).toBe(invoice.governmentTotal.toFixed(2));
    expect(sumOf("BROKER")).toBe(invoice.brokerTotal.toFixed(2));
    expect(money(invoice.governmentTotal).greaterThan(0)).toBe(true);

    const r = await revenueBetween(new Date(0), new Date(Date.now() + 60_000));
    expect(r.brokerRevenue).toBe(invoice.brokerTotal.toFixed(2));
    expect(r.governmentCollected).toBe(invoice.governmentTotal.toFixed(2));
  });
});
