import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Payment abstraction. Card processing in The Bahamas is not a solved problem
 * for every merchant, so bank transfer and manually recorded payment are
 * first-class methods here rather than fallbacks.
 */

export type PaymentMethod = "card" | "bank_transfer" | "account_credit" | "manual";

export interface PaymentIntent {
  id: string;
  provider: string;
  status: "requires_action" | "pending" | "succeeded" | "failed";
  /** Where to send the customer, when the provider needs to collect details. */
  redirectUrl?: string;
  instructions?: string;
}

export interface PaymentProvider {
  readonly name: string;
  supports(method: PaymentMethod): boolean;
  createIntent(input: {
    invoiceId: string; amount: string; currency: string;
    method: PaymentMethod; customerEmail: string;
  }): Promise<PaymentIntent>;
  /** Returns the invoice id a webhook refers to, or null if the signature fails. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<{ invoiceId: string; amount: string } | null>;
}

class ManualProvider implements PaymentProvider {
  readonly name = "manual";
  supports(method: PaymentMethod) { return method !== "card"; }

  async createIntent(input: { invoiceId: string; amount: string; currency: string }) {
    return {
      id: randomUUID(),
      provider: this.name,
      status: "pending" as const,
      instructions:
        `Transfer ${input.currency} ${input.amount} and quote reference ${input.invoiceId}. ` +
        `Your shipment moves as soon as the payment is confirmed.`,
    };
  }

  async verifyWebhook() { return null; }
}

/**
 * Stripe adapter. The shape is here so the rest of the application is already
 * written against it; the calls themselves need the SDK and live keys.
 */
class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  supports(method: PaymentMethod) { return method === "card"; }
  async createIntent(): Promise<PaymentIntent> {
    throw new Error("Stripe is not wired up yet. See src/lib/providers/payments.ts.");
  }
  async verifyWebhook(): Promise<{ invoiceId: string; amount: string } | null> {
    throw new Error("Stripe is not wired up yet.");
  }
}

export const payments: PaymentProvider =
  env.PAYMENT_PROVIDER === "stripe" ? new StripeProvider() : new ManualProvider();
