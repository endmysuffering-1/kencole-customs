import Image from "next/image";
import Link from "next/link";

const FEATURES = [
  "Duty, VAT and our fees worked out before you pay",
  "Every item checked by a licensed customs broker",
  "One invoice, with government charges and our fees shown apart",
  "Collect it yourself, or we deliver it to your door",
];

/** DockDrop's sign-in screen: the brand on ocean blue beside the form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ocean p-12 text-white md:flex">
        <div aria-hidden className="pointer-events-none absolute -right-36 -top-24 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(21,133,181,.3)_0%,transparent_70%)]" />
        <div className="relative">
          <Link href="/" aria-label="Kencole Customs Brokerage, home">
            <Image src="/brand/kencole-logo-white.png" alt="" width={1308} height={542} priority className="h-20 w-auto" />
          </Link>
          <p className="mt-12 max-w-md font-serif text-[2.6rem] font-bold leading-[1.15] tracking-tight">
            Your goods are here. We&apos;ll <em className="text-sky-light">clear</em> them.
          </p>
          <p className="mt-6 max-w-sm leading-relaxed text-white/60">
            Waiting at the port, the airport or your courier in Nassau? See what it costs first, then we clear it through
            Bahamas Customs.
          </p>
        </div>
        <ul className="relative space-y-4">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-center gap-3 text-sm text-white/80">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-coral" />
              {f}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-12">
        <div className="page-enter w-full max-w-[420px]">
          <Link href="/" aria-label="Kencole Customs Brokerage, home" className="mb-8 inline-flex rounded-field bg-ocean px-3 py-2 md:hidden">
            <Image src="/brand/kencole-wordmark-white-small.png" alt="" width={1308} height={489} className="h-9 w-auto" />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
