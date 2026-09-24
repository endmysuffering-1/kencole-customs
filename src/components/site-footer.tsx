import Image from "next/image";
import Link from "next/link";

const COLUMNS = [
  {
    title: "Clear with Kencole",
    links: [
      { href: "/#estimate", label: "Estimate your duty" },
      { href: "/shipments/new", label: "Clear a shipment" },
      { href: "/dashboard", label: "Your shipments" },
      { href: "/#how", label: "How it works" },
    ],
  },
  {
    title: "For businesses",
    links: [
      { href: "/register?type=business", label: "Open a business account" },
      { href: "/search?in=tariff&q=", label: "Look up a tariff code" },
    ],
  },
  {
    title: "Your account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Create an account" },
    ],
  },
];

/** Dark footer in the familiar online-shop layout, on every page. */
export function SiteFooter() {
  return (
    <footer className="mt-16 text-white">
      <a href="#" className="block bg-ink-500 py-3.5 text-center text-sm font-medium hover:bg-ink-500/90">
        Back to top
      </a>
      <div className="bg-ink-700">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-10 sm:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="font-bold">{c.title}</h2>
              <ul className="mt-3 space-y-2 text-sm text-white/80">
                {c.links.map((l) => (
                  <li key={l.label}><Link href={l.href} className="hover:text-white hover:underline">{l.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-ink">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-6 py-8 text-center text-xs text-white/60">
          <Image src="/brand/kencole-logo-white.png" alt="Kencole Customs Brokerage" width={1308} height={542} className="h-14 w-auto" />
          <p>Licensed customs brokers · Nassau, The Bahamas</p>
          <p>Estimates are not customs assessments. Bahamas Customs sets the final duty and VAT.</p>
        </div>
      </div>
    </footer>
  );
}
