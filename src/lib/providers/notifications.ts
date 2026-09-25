import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { renderEmail, type EmailContent } from "@/lib/email-layout";

/**
 * Notifications. Channels are pluggable; the events are not. Some messages
 * ("your shipment is held by customs") carry an obligation and cannot be
 * switched off by a preference.
 */

export type Channel = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

export type NotificationEvent =
  | "account.created" | "email.test" | "shipment.created" | "documents.missing" | "quote.ready" | "payment.required"
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

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  /** Where mail goes, in words, for the staff screen that tests it. */
  readonly description: string;
  /** False when messages only reach the server log. */
  readonly delivers: boolean;
  send(input: EmailMessage): Promise<void>;
}

/** Development and any deployment without a mail service: the message goes to the server log. */
class ConsoleEmail implements EmailProvider {
  readonly description = "Not sent yet: emails are written to the server log. Set EMAIL_PROVIDER=resend to send them.";
  readonly delivers = false;
  async send(input: EmailMessage) {
    console.info(`[email] to=${input.to} subject=${input.subject}\n${input.text}`);
  }
}

class ResendEmail implements EmailProvider {
  readonly delivers = true;
  get description() {
    return `Sent through Resend from ${env.EMAIL_FROM}.`;
  }
  async send(input: EmailMessage) {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: input.to, subject: input.subject, text: input.text, html: input.html }),
    });
    if (!res.ok) {
      // Resend explains refusals ("domain is not verified"); the reason matters more than the status.
      const detail = await res.json().then((b: { message?: string }) => b.message).catch(() => undefined);
      throw new Error(`Email send failed with status ${res.status}${detail ? `: ${detail}` : ""}.`);
    }
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
  content: EmailContent;
  channels?: Channel[];
}): Promise<void> {
  const channels = input.channels ?? ["IN_APP", "EMAIL"];
  const { text, html } = renderEmail(input.content);
  const summary = [input.content.heading, ...input.content.paragraphs].join(" ");

  await db.notification.create({
    data: {
      userId: input.userId, channel: "IN_APP", event: input.event,
      subject: input.subject, body: summary, sentAt: new Date(),
    },
  });

  if (channels.includes("EMAIL") && input.email) {
    await email.send({ to: input.email, subject: input.subject, text, html }).catch((e) => {
      console.error("notification email failed", e);
    });
  }
  if (channels.includes("SMS") && input.phone) {
    await sms.send({ to: input.phone, body: summary }).catch(() => undefined);
  }
}
