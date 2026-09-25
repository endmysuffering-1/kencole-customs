import Link from "next/link";
import { Calculator } from "@/components/public/calculator";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Icon, type IconName } from "@/components/shell/icons";
import { searchTariff } from "@/lib/services/tariff-service";

const FEATURES = [
  "Duty, VAT and our fees worked out before you pay",
  "Every item checked by a licensed customs broker",
  "Collect it yourself, or we deliver to your door",
];

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
      <section className="relative overflow-hidden bg-ocean text-white">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(21,133,181,.32)_0%,transparent_70%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">Licensed customs brokers · Nassau</p>
            <h1 className="mt-4 text-display font-bold">
              Your goods are here. We&apos;ll <em className="text-sky-light">clear</em> them.
            </h1>
            <p className="mt-5 max-w-lg leading-relaxed text-white/65">
              Waiting at the port, the airport or your courier? See the duty, VAT and our fees up front, then we clear it
              through Bahamas Customs.
            </p>
            <ul className="mt-6 space-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-white/80">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-coral" />{f}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="#estimate">Get an estimate →</LinkButton>
              <LinkButton href="/shipments/new" variant="secondary" className="bg-white/10 text-white ring-white/25 hover:bg-white/20 hover:text-white">
                Clear a shipment
              </LinkButton>
            </div>
          </div>

          <Card className="p-6 text-ink shadow-lift">
            <p className="font-serif text-lg font-semibold text-ocean">Track a shipment</p>
            <p className="mt-1 text-sm text-ink-500">Enter your shipment reference to see where it is.</p>
            <form action="/search" className="mt-4 flex gap-2">
              <label htmlFor="track-ref" className="sr-only">Shipment reference</label>
              <input id="track-ref" name="q" placeholder="KCB-2026-000123" className={`${inputClass} num font-mono`} />
              <button type="submit" className="shrink-0 rounded-field bg-coral px-4 text-sm font-semibold text-white hover:bg-coral-600">Track</button>
            </form>
            <div className="my-5 h-px bg-line" />
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-ink-500">What you&apos;ll need</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              {NEEDS.map((n) => (
                <li key={n} className="flex gap-2"><span aria-hidden className="font-bold text-success">✓</span>{n}</li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      <section className="mx-auto mt-12 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-3" aria-label="Get started">
        <Tile icon="calculator" title="Estimate your duty" href="#estimate" cta="Open the calculator">
          Duty, VAT, levies and our fees for what you&apos;re importing, before you commit to anything.
        </Tile>
        <Tile icon="box" title="Clear a shipment" href="/shipments/new" cta="Start now">
          Tell us what&apos;s arrived and where it&apos;s waiting. A licensed broker takes it from there.
        </Tile>
        <Tile icon="users" title="Importing for a business?" href="/register?type=business" cta="Open a business account">
          One account for your team, every entry and invoice in one place, and your tariff history to speed up the next one.
        </Tile>
      </section>

      <section id="estimate" className="mx-auto mt-16 max-w-6xl scroll-mt-6 px-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">Duty calculator</p>
        <h2 className="mt-1 text-title font-bold text-ocean">Estimate what you&apos;ll pay to clear it</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">List prices from the current rate table. A licensed broker checks every item before you&apos;re quoted.</p>
        <div className="mt-6"><Calculator initialCode={initialCode} /></div>
      </section>

      <section id="how" className="mx-auto mt-16 max-w-6xl scroll-mt-6 px-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">How it works</p>
        <h2 className="mt-1 text-title font-bold text-ocean">Four steps, one invoice</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full p-5">
                <span className="num flex h-9 w-9 items-center justify-center rounded-full bg-coral font-serif text-base font-bold text-white">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold text-ocean">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <Card className="grid gap-6 p-6 md:grid-cols-2 md:items-center md:p-8">
          <div>
            <h2 className="text-title font-bold text-ocean">Your money, in two columns</h2>
            <p className="mt-3 leading-relaxed text-ink-500">
              Duty, VAT and levies are collected for the Public Treasury and passed straight to Bahamas Customs. Our fees
              are ours. We never blend them, on the estimate, the quote or the invoice.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-field border-l-4 border-treasury bg-treasury-100/60 p-4">
              <p className="font-semibold">Government charges</p>
              <p className="mt-1 text-ink-500">Import duty, VAT, environmental levy, customs processing fee.</p>
            </div>
            <div className="rounded-field border-l-4 border-teal bg-teal-100/60 p-4">
              <p className="font-semibold">Kencole&apos;s fees</p>
              <p className="mt-1 text-ink-500">Brokerage and processing, plus delivery if you want it.</p>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}

function Tile({ icon, title, href, cta, children }: { icon: IconName; title: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group rounded-card border border-line bg-white p-5 shadow-card transition hover:-translate-y-px hover:border-line-hover hover:shadow-lift">
      <span className="flex h-10 w-10 items-center justify-center rounded-field bg-paper-sunk text-ocean"><Icon name={icon} /></span>
      <h2 className="mt-4 text-lg font-semibold text-ocean">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{children}</p>
      <p className="mt-4 text-sm font-semibold text-coral group-hover:underline">{cta} →</p>
    </Link>
  );
}
