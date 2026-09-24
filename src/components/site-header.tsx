import Image from "next/image";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { can, isStaff } from "@/lib/auth/rbac";
import { ROLE_NAMES } from "@/lib/auth/roles";
import { homeFor } from "@/lib/auth/home";
import { SignOutButton } from "./sign-out-button";

/**
 * Two bars, in the familiar online-shop layout: the top one carries the logo, a
 * search box and the account; the strip under it carries the places to go.
 */
export async function SiteHeader() {
  const user = await getSessionUser();
  const first = user?.fullName.split(/\s+/)[0];

  const strip = [
    { href: "/#estimate", label: "Estimate duty" },
    user && can(user.role, "shipment:create") && { href: "/shipments/new", label: "Clear a shipment" },
    user && can(user.role, "shipment:create") && { href: "/dashboard", label: "Your shipments" },
    user && can(user.role, "ops:queue") && { href: "/ops", label: "Operations" },
    user && can(user.role, "classification:approve") && { href: "/broker", label: "Broker review" },
    user && can(user.role, "rates:read") && { href: "/admin/rates", label: "Rates" },
    user && can(user.role, "users:manage") && { href: "/admin/users", label: "Users" },
    { href: "/#how", label: "How it works" },
    !user && { href: "/register?type=business", label: "Business accounts" },
  ].filter((l): l is { href: string; label: string } => Boolean(l));

  const accountHref = user ? homeFor(user.role) : "/login";

  return (
    <header className="text-white">
      <div className="bg-ink">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-6">
          <Link href="/" className="-ml-1 flex items-end gap-2 rounded-sm p-1 ring-white/70 hover:ring-1" aria-label="Kencole Customs Brokerage, home">
            {/* The brand script, recoloured white: its gold is too close to the
                yellow and orange of the buttons. See design/brand/. */}
            <Image src="/brand/kencole-wordmark-white-small.png" alt="" width={1308} height={489} priority className="h-9 w-auto sm:h-11" />
            <span className="mb-1 hidden text-[0.6rem] font-medium uppercase tracking-[0.3em] text-white/60 lg:inline">
              Customs Brokerage
            </span>
          </Link>

          <form action="/search" role="search" className="order-last flex h-10 w-full overflow-hidden rounded-md bg-white ring-buy focus-within:ring-2 md:order-none md:w-auto md:flex-1">
            <label htmlFor="site-search-in" className="sr-only">Search in</label>
            <select id="site-search-in" name="in" defaultValue="all" className="hidden border-0 border-r sm:block border-ink/15 bg-paper-sunk py-0 pl-3 pr-7 text-xs text-ink focus:ring-0">
              <option value="all">All</option>
              <option value="tariff">Tariff codes</option>
              {user && <option value="shipments">Your shipments</option>}
            </select>
            <label htmlFor="site-search" className="sr-only">Search</label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder={user ? "Search a shipment reference, an item, or a tariff code" : "Search tariff codes, e.g. laptop or 8471"}
              className="min-w-0 flex-1 border-0 px-3 text-sm text-ink placeholder:text-ink-300 focus:ring-0"
            />
            <button type="submit" aria-label="Search" className="flex w-12 items-center justify-center bg-action text-ink hover:bg-action-hover">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </button>
          </form>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <Link href={accountHref} className="rounded-sm px-2 py-1 leading-tight ring-white/70 hover:ring-1">
              <span className="block text-xs text-white/75">{user ? `Hello, ${first}` : "Hello, sign in"}</span>
              <span className="block text-sm font-bold">
                {!user ? "Account" : isStaff(user.role) ? ROLE_NAMES[user.role] : <>Account<span className="hidden sm:inline"> &amp; shipments</span></>}
              </span>
            </Link>
            {user ? (
              <SignOutButton />
            ) : (
              <Link href="/register" className="rounded-sm px-2 py-1 leading-tight ring-white/70 hover:ring-1">
                <span className="hidden text-xs text-white/75 sm:block">New here?</span>
                <span className="block text-sm font-bold">Create account</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      <nav aria-label="Main" className="bg-ink-700">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 py-1 text-sm sm:px-5">
          {strip.map((l) => (
            <Link key={l.href} href={l.href} className="shrink-0 rounded-sm px-2 py-1.5 font-medium text-white ring-white/70 hover:ring-1">
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
