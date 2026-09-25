import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: "Kencole Customs Brokerage", template: "%s · Kencole" },
  description: "Licensed customs brokers in Nassau. We clear goods waiting at the port, the airport or your courier, and tell you what it costs first.",
};

/** Each area brings its own frame: (public) a header and footer, (auth) the
 *  two-panel sign-in screen, (app) the sidebar. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-BS" className={`${dmSans.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-paper font-sans">{children}</body>
    </html>
  );
}
