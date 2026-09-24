import Link from "next/link";
import { Calculator } from "@/components/public/calculator";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { searchTariff } from "@/lib/services/tariff-service";

const STEPS = [
  { title: "Tell us what's arrived", body: "Say where your goods are waiting and upload the seller's invoice. It takes a few minutes." },
  { title: "A licensed broker reviews it", body: "Every item is classified by a licensed Bahamian customs broker before you're quoted." },
  { title: "Pay one invoice", body: "Government duty and VAT, and our fees, shown separately so you know where every dollar goes." },
  { title: "We clear it, you collect", body: "We lodge your entry with Bahamas Customs. Collect your goods once released, or we'll deliver them." },
];

const NEEDS = [
  "The seller's commercial invoice",
  "The air waybill, bill of lading or courier tracking number",
  "Where the goods are waiting: port, airport or courier",
  "A permit, for some goods such as spirits or medicines",
];

export default async function Home({ searchParams }: { searchParams: Promise<{ hs?: string }> }) {
  const { hs } = await searchParams;
  // A tariff code picked from search opens the calculator already set to it.
  const initialCode = hs ? (await searchTariff(hs, 5)).find((c) => c.code === hs) ?? null : null;

  return (
    <main>
      {/* Banner that fades into the page, with the cards laid over its foot. */}
      <section className="bg-gradient-to-b from-ink-700 via-ink-700 to-paper text-white">
        <div className="mx-auto max-w-7xl px-4 pb-48 pt-10 sm:px-6 sm:pt-14">
          <p className="text-sm font-semibold uppercase tracking-widest text-white/70">Licensed customs brokers · Nassau</p>
          <h1 className="mt-3 max-w-3xl text-display font-bold leading-[1.02] tracking-tight">Your goods are here. We&apos;ll clear them.</h1>
          <p className="mt-4 max-w-xl text-lg text-white/85">
            Waiting at the port, the airport or your courier? See the duty, VAT and our fees up front, then we clear it
            through Bahamas Customs. You collect it, or we deliver.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href="#estimate">Get an estimate</LinkButton>
            <LinkButton href="/shipments/new" variant="secondary">Clear a shipment</LinkButton>
          </div>
        </div>
      </section>

      <section className="relative mx-auto -mt-36 grid max-w-7xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4" aria-label="Get started">
        <HomeCard title="Estimate your duty" icon={<CalcIcon />}>
          <p>Duty, VAT, levies and our fees for what you&apos;re importing, before you commit to anything.</p>
          <Link href="#estimate" className="mt-auto pt-4 font-semibold text-ink underline decoration-ink-300 underline-offset-2 hover:decoration-ink">Open the calculator</Link>
        </HomeCard>
        <HomeCard title="Track a shipment" icon={<SearchIcon />}>
          <p>Enter your shipment reference to see where it is.</p>
          <form action="/search" className="mt-auto flex gap-2 pt-4">
            <label htmlFor="track-ref" className="sr-only">Shipment reference</label>
            <input id="track-ref" name="q" placeholder="KCB-2026-000123" className={`${inputClass} num`} />
            <button type="submit" className="rounded-full bg-action px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-action-edge hover:bg-action-hover">Go</button>
          </form>
        </HomeCard>
        <HomeCard title="What you'll need" icon={<ListIcon />}>
          <ul className="space-y-1.5">
            {NEEDS.map((n) => (
              <li key={n} className="flex gap-2"><span aria-hidden className="text-ink-300">✓</span>{n}</li>
            ))}
          </ul>
        </HomeCard>
        <HomeCard title="Importing for a business?" icon={<BuildingIcon />}>
          <p>One account for your team, every entry and invoice in one place, and your own tariff history to speed up the next one.</p>
          <LinkButton href="/register?type=business" className="mt-auto self-start">Open a business account</LinkButton>
        </HomeCard>
      </section>

      <section id="estimate" className="mx-auto mt-10 max-w-7xl scroll-mt-4 px-4 sm:px-6">
        <h2 className="text-xl font-bold">Estimate what you&apos;ll pay to clear it</h2>
        <p className="mt-1 text-sm text-ink-500">List prices, worked out from the current rate table. A licensed broker checks every item before you&apos;re quoted.</p>
        <div className="mt-4">
          <Calculator initialCode={initialCode} />
        </div>
      </section>

      <section id="how" className="mx-auto mt-12 max-w-7xl scroll-mt-4 px-4 sm:px-6">
        <h2 className="text-xl font-bold">How it works</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full p-5">
                <span className="num inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 font-bold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-700">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-12 max-w-7xl px-4 sm:px-6">
        <Card className="grid gap-6 p-6 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-xl font-bold">Your money, in two columns</h2>
            <p className="mt-2 leading-relaxed text-ink-700">
              Duty, VAT and levies are collected for the Public Treasury and passed straight to Bahamas Customs. Our fees
              are ours. We never blend them, on the estimate, the quote or the invoice.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-card border-l-4 border-treasury bg-treasury-100/60 p-4">
              <p className="font-semibold">Government charges</p>
              <p className="mt-1 text-ink-700">Import duty, VAT, environmental levy, customs processing fee.</p>
            </div>
            <div className="rounded-card border-l-4 border-teal bg-teal-100/60 p-4">
              <p className="font-semibold">Kencole&apos;s fees</p>
              <p className="mt-1 text-ink-700">Brokerage and processing, plus delivery if you want it.</p>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}

function HomeCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="flex min-h-[15rem] flex-col p-5 text-sm text-ink-700">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <span className="text-ink-300">{icon}</span>
      </div>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </Card>
  );
}

const svg = "h-8 w-8";
const CalcIcon = () => (
  <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M16 11v6M8 14h2M12 14h2M8 17h2M12 17h2" strokeLinecap="round" />
  </svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M3 8l9-5 9 5v8l-9 5-9-5z" strokeLinejoin="round" /><path d="M3 8l9 5 9-5M12 13v8" strokeLinejoin="round" />
  </svg>
);
const ListIcon = () => (
  <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M8.5 10l1.5 1.5L13 8.5M8.5 16l1.5 1.5L13 14.5M15 10h1M15 16h1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BuildingIcon = () => (
  <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M4 21V5l8-2v18M12 8l8 2v11M3 21h18M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
