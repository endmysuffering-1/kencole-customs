import Image from "next/image";
import Link from "next/link";
import { Calculator } from "@/components/public/calculator";

const STEPS = [
  { title: "Tell us what's arrived", body: "Say where your goods are waiting and upload the seller's invoice. It takes a few minutes." },
  { title: "A licensed broker reviews it", body: "Every item is classified by a licensed Bahamian customs broker before you're quoted." },
  { title: "Pay one invoice", body: "Government duty and VAT, and our fees, shown separately so you know where every dollar goes." },
  { title: "We clear it, you collect", body: "We lodge your entry with Bahamas Customs. Collect your goods once released, or we'll deliver them." },
];

export default function Home() {
  return (
    <main>
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:pt-20">
          <div className="lg:pt-6">
            <p className="text-sm font-semibold uppercase tracking-widest text-white/60">Licensed customs brokers · Nassau</p>
            <h1 className="mt-4 text-display font-bold leading-[1.05] tracking-tight">Your goods are here. We'll clear them.</h1>
            <p className="mt-5 max-w-md text-lg text-white/75">
              Waiting at the port, the airport or your courier? We work out the duty, VAT and our fees up front, clear
              it through Bahamas Customs, and you collect it or we deliver.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <Link href="/register" className="rounded-md bg-white px-4 py-2 font-semibold text-ink hover:bg-paper">Open an account</Link>
              <Link href="/login" className="rounded-md px-4 py-2 font-semibold text-white ring-1 ring-inset ring-white/30 hover:bg-white/10">Sign in</Link>
            </div>
          </div>
          <Calculator />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-title font-bold">How it works</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="num text-sm font-bold text-ink-500">0{i + 1}</span>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-700">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-ink/10">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="text-title font-bold">Your money, in two columns</h2>
            <p className="mt-3 leading-relaxed text-ink-700">
              Duty, VAT and levies are collected for the Public Treasury and passed straight to Bahamas Customs. Our fees are
              ours. We never blend them, on the estimate, the quote or the invoice.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-card border-l-4 border-ochre bg-paper-card p-5 shadow-card">
              <p className="font-semibold">Government charges</p>
              <p className="mt-1 text-ink-700">Import duty, VAT, environmental levy, customs processing fee.</p>
            </div>
            <div className="rounded-card border-l-4 border-teal bg-paper-card p-5 shadow-card">
              <p className="font-semibold">Kencole's fees</p>
              <p className="mt-1 text-ink-700">Brokerage and processing, plus delivery if you want it, set out before you pay.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 py-10 text-sm text-ink-500 sm:px-6">
          <div>
            <Image src="/brand/kencole-logo-ink.png" alt="Kencole Customs Brokerage" width={1308} height={542} className="h-20 w-auto" />
            <p className="mt-3">Nassau, The Bahamas</p>
          </div>
          <span>Estimates are not customs assessments.</span>
        </div>
      </footer>
    </main>
  );
}
