import Image from "next/image";
import Link from "next/link";

const COLUMNS = [
  {
    title: "Clear with Kencole",
    links: [
      { href: "/#estimate", label: "Estimate your duty" },
      { href: "/shipments/new", label: "Clear a shipment" },
      { href: "/shipments", label: "Your shipments" },
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

/** The public pages' footer, on ocean blue. */
export function SiteFooter() {
  return (
    <footer className="mt-20 bg-ocean text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Image src="/brand/kencole-logo-white.png" alt="Kencole Customs Brokerage" width={1308} height={542} className="h-16 w-auto" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
            Licensed customs brokers in Nassau. We clear goods waiting at the port, the airport or your courier.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h2 className="font-serif text-base font-semibold">{c.title}</h2>
            <ul className="mt-3 space-y-2 text-sm text-white/65">
              {c.links.map((l) => (
                <li key={l.label}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-6 py-5 text-xs text-white/45">
          Estimates are not customs assessments. Bahamas Customs sets the final duty and VAT.
        </p>
      </div>
    </footer>
  );
}
