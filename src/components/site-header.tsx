import Image from "next/image";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ROLE_NAMES } from "@/lib/auth/roles";
import { SignOutButton } from "./sign-out-button";


export async function SiteHeader() {
  const user = await getSessionUser();
  const links = user
    ? [
        can(user.role, "shipment:create") && { href: "/dashboard", label: "My shipments" },
        can(user.role, "ops:queue") && { href: "/ops", label: "Operations" },
        can(user.role, "classification:approve") && { href: "/broker", label: "Broker review" },
        can(user.role, "rates:read") && { href: "/admin/rates", label: "Rates" },
        can(user.role, "users:manage") && { href: "/admin/users", label: "Users" },
      ].filter((l): l is { href: string; label: string } => Boolean(l))
    : [];

  return (
    <header className="bg-ink text-white">
      {/* On a phone the nav drops to its own scrollable row under the logo. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex items-end gap-3" aria-label="Kencole Customs Brokerage, home">
          {/* The brand script, recoloured white: the gold original is too close to
              the ochre that marks government charges. See design/brand/. */}
          <Image src="/brand/kencole-wordmark-white-small.png" alt="" width={1308} height={489} priority className="h-12 w-auto" />
          <span className="mb-1.5 hidden text-[0.65rem] font-medium uppercase tracking-[0.3em] text-white/60 sm:inline">
            Customs Brokerage
          </span>
        </Link>
        {links.length > 0 && (
          <nav className="order-last -mx-3 flex w-[calc(100%+1.5rem)] gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1" aria-label="Main">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
        {user ? (
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-sm leading-tight sm:block">
              <span className="block font-medium">{user.fullName}</span>
              <span className="block text-xs text-white/60">{ROLE_NAMES[user.role]}</span>
            </span>
            <SignOutButton />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:text-white">
              Sign in
            </Link>
            <Link href="/register" className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-paper">
              Create account
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
