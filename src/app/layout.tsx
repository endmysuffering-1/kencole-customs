import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Kencole Customs Brokerage", template: "%s · Kencole" },
  description: "Licensed customs brokerage in The Bahamas. Find out what an import will really cost before it ships.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-BS" className={archivo.variable}>
      <body className="min-h-screen font-sans">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
