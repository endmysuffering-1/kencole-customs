import { requireCapability } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";
import { renderEmail } from "@/lib/email-layout";
import { email } from "@/lib/providers/notifications";
import { DomainError } from "@/lib/services/errors";

/**
 * Sends one email to the administrator asking, so they can see the mail
 * service works end to end. Unlike customer notifications, a failure here is
 * reported, with the mail service's reason.
 */
export const POST = handle(async () => {
  const user = await requireCapability("users:manage");
  const { text, html } = renderEmail({
    greetingName: user.fullName,
    heading: "Kencole can send email",
    paragraphs: [
      "This is the test you asked for from the Users page. Customers get messages like this one when their shipment needs them or moves on.",
    ],
    action: { label: "Open Kencole", path: "/" },
  });
  try {
    await email.send({ to: user.email, subject: "Test email from Kencole", text, html });
  } catch (e) {
    console.error("test email failed", e);
    throw new DomainError(e instanceof Error ? e.message : "The email was not sent.", 502);
  }
  return json({ sentTo: user.email, delivered: email.delivers });
});
