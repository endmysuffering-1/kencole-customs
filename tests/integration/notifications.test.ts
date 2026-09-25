import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { email } from "@/lib/providers/notifications";
import { registerUser } from "@/lib/services/auth-service";
import { transitionShipment } from "@/lib/services/shipment-service";
import { registrationSchema } from "@/lib/validation/schemas";
import { createShipment, createUser, resetDatabase, seedRates } from "../helpers/db";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

const sent = () => vi.spyOn(email, "send");

describe("customer emails", () => {
  it("welcomes a new account and points at clearing a shipment", async () => {
    const spy = sent();
    const user = await registerUser(registrationSchema.parse({
      fullName: "Marcus Deveaux", email: "marcus@example.com", password: "A-long-enough-Passphrase-2026", accountType: "personal",
    }));
    expect(spy).toHaveBeenCalledTimes(1);
    const message = spy.mock.calls[0]![0];
    expect(message).toMatchObject({ to: "marcus@example.com", subject: "Welcome to Kencole" });
    expect(message.text).toMatch(/^Hello Marcus,/);
    expect(message.text).toContain("/shipments/new");
    expect(await db.notification.count({ where: { userId: user.id, event: "account.created" } })).toBe(1);
  });

  it("still creates the account when the mail service is down", async () => {
    vi.spyOn(email, "send").mockRejectedValue(new Error("mail service unreachable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await registerUser(registrationSchema.parse({
      fullName: "Ann Rolle", email: "ann@example.com", password: "A-long-enough-Passphrase-2026", accountType: "personal",
    }));
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
  });

  async function released(deliveryRequested: boolean) {
    const { shirts } = await seedRates();
    const staff = await createUser("CUSTOMS_BROKER");
    const owner = await db.user.create({
      data: { email: "owner@example.com", fullName: "Joel Stubbs", role: "CONSUMER", passwordHash: "x" },
    });
    const shipment = await createShipment({
      ownerId: owner.id, status: "SUBMITTED_TO_CUSTOMS", commercialInvoice: true,
      lines: [{ lineValue: "100.00", hsCodeId: shirts.id }],
    });
    await db.shipment.update({
      where: { id: shipment.id },
      data: { description: "Laptop", heldAt: "Air cargo, Lynden Pindling International Airport", deliveryRequested },
    });
    const spy = sent();
    await transitionShipment({ shipmentId: shipment.id, to: "CUSTOMS_RELEASED", actorId: staff.id });
    return { spy, shipment };
  }

  it("tells a customer who collects where to collect from, with the reference", async () => {
    const { spy, shipment } = await released(false);
    const message = spy.mock.calls[0]![0];
    expect(message.subject).toBe(`${shipment.reference}: Released by customs`);
    expect(message.text).toContain("Laptop has cleared customs");
    expect(message.text).toContain("ready to collect from Air cargo, Lynden Pindling International Airport");
    expect(message.text).toContain(`/shipments/${shipment.id}`);
  });

  it("tells a customer who asked for delivery that we'll arrange it", async () => {
    const { spy } = await released(true);
    expect(spy.mock.calls[0]![0].text).toContain("We'll be in touch to arrange delivery.");
  });
});
