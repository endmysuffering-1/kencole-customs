import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Notifications. Channels are pluggable; the events are not. Some messages
 * ("your shipment is held by customs") carry an obligation and cannot be
 * switched off by a preference.
 */

export type Channel = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

export type NotificationEvent =
  | "shipment.created" | "documents.missing" | "quote.ready" | "payment.required"
  | "payment.received" | "shipment.arrived" | "customs.hold" | "information.required"
  | "customs.released" | "delivery.scheduled" | "delivery.out" | "delivery.completed";

/** Events the customer may not opt out of. */
const MANDATORY: NotificationEvent[] = [
  "documents.missing", "payment.required", "customs.hold",
  "information.required", "customs.released",
];

export function isMandatory(event: NotificationEvent): boolean {
  return MANDATORY.includes(event);
}

export interface EmailProvider {
  send(input: { to: string; subject: string; body: string }): Promise<void>;
}

class ConsoleEmail implements EmailProvider {
  async send(input: { to: string; subject: string; body: string }) {
    console.info(`[email] to=${input.to} subject=${input.subject}\n${input.body}`);
  }
}

class ResendEmail implements EmailProvider {
  async send(input: { to: string; subject: string; body: string }) {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: input.to, subject: input.subject, text: input.body }),
    });
    if (!res.ok) throw new Error(`Email send failed with status ${res.status}.`);
  }
}

export const email: EmailProvider =
  env.EMAIL_PROVIDER === "resend" ? new ResendEmail() : new ConsoleEmail();

/** SMS and WhatsApp exist as interfaces so the call sites can be written now. */
export interface MessagingProvider { send(input: { to: string; body: string }): Promise<void> }

export const sms: MessagingProvider = {
  async send(input) { console.info(`[sms] to=${input.to}: ${input.body}`); },
};

export const whatsapp: MessagingProvider = {
  async send(input) { console.info(`[whatsapp] to=${input.to}: ${input.body}`); },
};

export async function notify(input: {
  userId: string;
  email?: string | null;
  phone?: string | null;
  event: NotificationEvent;
  subject: string;
  body: string;
  channels?: Channel[];
}): Promise<void> {
  const channels = input.channels ?? ["IN_APP", "EMAIL"];

  await db.notification.create({
    data: {
      userId: input.userId, channel: "IN_APP", event: input.event,
      subject: input.subject, body: input.body, sentAt: new Date(),
    },
  });

  if (channels.includes("EMAIL") && input.email) {
    await email.send({ to: input.email, subject: input.subject, body: input.body }).catch((e) => {
      console.error("notification email failed", e);
    });
  }
  if (channels.includes("SMS") && input.phone) {
    await sms.send({ to: input.phone, body: input.body }).catch(() => undefined);
  }
}
