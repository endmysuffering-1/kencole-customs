import type { Metadata } from "next";
import { AdaptiveShell } from "@/components/shell/adaptive-shell";
import { Calculator } from "@/components/public/calculator";
import { searchTariff } from "@/lib/services/tariff-service";

export const metadata: Metadata = { title: "Duty calculator" };

export default async function CalculatorPage({ searchParams }: { searchParams: Promise<{ hs?: string }> }) {
  const { hs } = await searchParams;
  const initialCode = hs ? (await searchTariff(hs, 5)).find((c) => c.code === hs) ?? null : null;
  return (
    <AdaptiveShell>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <p className="mb-4 max-w-2xl text-sm text-ink-500">
          List prices from the current rate table. A licensed broker checks every item before you&apos;re quoted, and Bahamas
          Customs sets the final duty and VAT.
        </p>
        <Calculator initialCode={initialCode} />
      </main>
    </AdaptiveShell>
  );
}
