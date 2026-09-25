import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/email-layout";

describe("the email layout", () => {
  const email = renderEmail({
    greetingName: "Simone Pinder",
    heading: "Your quote for <script>alert(1)</script> is ready",
    paragraphs: ["Duty & VAT are listed apart from our fees."],
    action: { label: "See your quote", path: "/shipments/abc" },
  });

  it("greets by first name and links to the page in full, in both parts", () => {
    expect(email.text).toMatch(/^Hello Simone,/);
    expect(email.text).toContain("See your quote: http://localhost:3000/shipments/abc");
    expect(email.html).toContain('href="http://localhost:3000/shipments/abc"');
  });

  it("escapes what the customer typed, so a description cannot inject markup", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("Duty &amp; VAT");
  });

  it("says estimates are not customs assessments", () => {
    expect(email.text).toContain("Bahamas Customs sets the final duty and VAT.");
    expect(email.html).toContain("Bahamas Customs sets the final duty and VAT.");
  });

  it("greets plainly without a name, and leaves the button out without an action", () => {
    const plain = renderEmail({ heading: "Hi", paragraphs: [] });
    expect(plain.text).toMatch(/^Hello,/);
    expect(plain.html).not.toContain("<a href");
  });
});
