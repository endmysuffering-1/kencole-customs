import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Kencole Customs Brokerage", template: "%s · Kencole" },
  description: "Licensed customs brokers in Nassau. We clear goods waiting at the port, the airport or your courier, and tell you what it costs first.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-BS" className={archivo.variable}>
      <body className="flex min-h-screen flex-col bg-paper font-sans">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
