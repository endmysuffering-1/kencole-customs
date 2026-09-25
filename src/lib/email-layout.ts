import { env } from "@/lib/env";

/**
 * Every email Kencole sends, laid out once: a plain-text part for any mail
 * client, and an HTML part in the site's colours. Email clients ignore
 * stylesheets and web fonts, so the HTML is tables with inline styles and
 * system fonts. The wordmark is text, not an image, so it shows even when a
 * client blocks images.
 */

export interface EmailContent {
  /** The first line after the greeting, and the preview most inboxes show. */
  heading: string;
  paragraphs: string[];
  /** A path on this site ("/shipments/abc"), turned into a full link. */
  action?: { label: string; path: string };
  greetingName?: string | null;
}

export interface RenderedEmail {
  text: string;
  html: string;
}

export function absoluteUrl(path: string): string {
  return new URL(path, env.APP_URL || "http://localhost:3000").toString();
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FOOTER = "Kencole Customs Brokerage · Licensed customs brokers in Nassau, The Bahamas";
const DISCLAIMER = "Estimates are not customs assessments. Bahamas Customs sets the final duty and VAT.";

export function renderEmail(content: EmailContent): RenderedEmail {
  const first = content.greetingName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hello ${first},` : "Hello,";
  const url = content.action ? absoluteUrl(content.action.path) : null;

  const text = [
    greeting,
    "",
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.action && url ? [`${content.action.label}: ${url}`, ""] : []),
    "Kencole Customs Brokerage",
    "",
    "--",
    DISCLAIMER,
  ].join("\n");

  const font = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const serif = "Georgia, 'Times New Roman', serif";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(content.heading)}</title></head>
<body style="margin:0;padding:0;background:#FDFAF4;">
<div style="display:none;max-height:0;overflow:hidden;">${escape(content.heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDFAF4;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4EEF3;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0B3D59;padding:20px 28px;">
        <span style="font-family:${serif};font-size:24px;font-style:italic;color:#FFFFFF;">Kencole</span>
        <span style="font-family:${font};font-size:10px;letter-spacing:3px;color:#7DD4F5;padding-left:8px;">CUSTOMS BROKERAGE</span>
      </td></tr>
      <tr><td style="padding:28px 28px 8px 28px;font-family:${font};font-size:15px;line-height:1.6;color:#0D1F2D;">
        <p style="margin:0 0 12px 0;">${escape(greeting)}</p>
        <h1 style="margin:0 0 16px 0;font-family:${serif};font-size:22px;line-height:1.3;color:#0B3D59;">${escape(content.heading)}</h1>
        ${content.paragraphs.map((p) => `<p style="margin:0 0 14px 0;">${escape(p)}</p>`).join("\n        ")}
      </td></tr>
      ${content.action && url ? `<tr><td style="padding:4px 28px 24px 28px;">
        <a href="${escape(url)}" style="display:inline-block;background:#E8501A;color:#FFFFFF;font-family:${font};font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:10px;">${escape(content.action.label)}</a>
      </td></tr>` : ""}
      <tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #E4EEF3;font-family:${font};font-size:12px;line-height:1.5;color:#5A7A8A;">
        ${escape(FOOTER)}<br>${escape(DISCLAIMER)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { text, html };
}
