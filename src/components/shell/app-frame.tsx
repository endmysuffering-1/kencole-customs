"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { SignOutButton } from "@/components/sign-out-button";
import { Icon, type IconName } from "./icons";

export interface NavItem { href: string; label: string; icon: IconName; badge?: number }
export interface NavSection { title: string; items: NavItem[] }

/** Page titles for the top bar, most specific first. */
const TITLES: [RegExp, string][] = [
  [/^\/dashboard/, "Home"],
  [/^\/shipments\/new/, "Clear a shipment"],
  [/^\/shipments\/[^/]+/, "Shipment"],
  [/^\/shipments/, "Your shipments"],
  [/^\/ops\/shipments\//, "Shipment"],
  [/^\/ops/, "Operations"],
  [/^\/broker/, "Broker review"],
  [/^\/admin\/rates/, "Rates"],
  [/^\/admin\/users/, "Users"],
  [/^\/calculator/, "Duty calculator"],
  [/^\/search/, "Search"],
];

const isActive = (pathname: string, href: string) =>
  href === "/shipments" ? pathname === "/shipments" || (/^\/shipments\/(?!new)/.test(pathname)) : pathname === href || pathname.startsWith(`${href}/`);

export function AppFrame({
  sections, user, canCreate, children,
}: {
  sections: NavSection[];
  user: { name: string; initials: string; role: string };
  canCreate: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Kencole";
  const tabs = sections.flatMap((s) => s.items).slice(0, 5);

  return (
    <div className="min-h-screen">
      {/* Phone: the sidebar slides in over a dimmed page. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn("fixed inset-0 z-40 bg-black/45 transition-opacity md:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-ocean px-4 py-6 text-white transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0 shadow-[4px_0_30px_rgba(0,0,0,.2)]" : "-translate-x-full",
        )}
        aria-label="Sidebar"
      >
        <Link href="/" className="mb-6 flex px-3" aria-label="Kencole Customs Brokerage, public site">
          <Image src="/brand/kencole-wordmark-white-small.png" alt="" width={1308} height={489} priority className="h-10 w-auto" />
        </Link>

        <nav className="flex-1 overflow-y-auto" aria-label="Main">
          {sections.map((s) => (
            <div key={s.title}>
              <p className="mb-1.5 mt-4 px-3 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/35">{s.title}</p>
              {s.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-medium transition",
                      active
                        ? "bg-white/[.13] text-white before:absolute before:inset-y-[20%] before:left-0 before:w-[3px] before:rounded-r before:bg-coral"
                        : "text-white/60 hover:bg-white/[.08] hover:text-white",
                    )}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.badge ? <span className="ml-auto rounded-full bg-coral px-2 py-0.5 text-[0.62rem] font-bold text-white">{item.badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <p className="mb-1.5 mt-4 px-3 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/35">Account</p>
          <Link href="/" className="flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-white/[.08] hover:text-white">
            <Icon name="globe" /> Public site
          </Link>
          <SignOutButton className="flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-white/60 hover:bg-white/[.08] hover:text-white">
            <Icon name="exit" /> Sign out
          </SignOutButton>
        </nav>

        <div className="mt-4 flex items-center gap-3 rounded-field bg-white/[.07] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky text-sm font-semibold">{user.initials}</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block text-xs text-white/45">{user.role}</span>
          </span>
        </div>
      </aside>

      <div className="min-h-screen pb-20 md:ml-60 md:pb-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-paper-sunk text-ocean md:hidden"
          >
            <Icon name="menu" />
          </button>
          <p className="font-serif text-xl font-semibold tracking-tight text-ocean">{title}</p>
          <form action="/search" role="search" className="ml-auto hidden w-full max-w-sm items-center gap-2 rounded-field border-[1.5px] border-line-strong bg-white px-3 focus-within:border-sky focus-within:ring-[3px] focus-within:ring-sky/15 sm:flex">
            <Icon name="search" className="h-4 w-4 shrink-0 text-ink-500" />
            <label htmlFor="app-search" className="sr-only">Search</label>
            <input id="app-search" name="q" type="search" placeholder="Search a reference, an item or a tariff code" className="w-full border-0 bg-transparent py-2 text-sm placeholder:text-ink-300 focus:outline-none focus:ring-0" />
          </form>
          <Link href="/search" aria-label="Search" className="ml-auto flex h-9 w-9 items-center justify-center rounded-[9px] bg-paper-sunk text-ocean sm:hidden">
            <Icon name="search" />
          </Link>
          {canCreate && (
            <Link href="/shipments/new" className="hidden shrink-0 rounded-[8px] bg-coral px-3.5 py-2 text-sm font-semibold text-white hover:bg-coral-600 lg:inline-flex">
              + Clear a shipment
            </Link>
          )}
        </header>
        <div key={pathname} className="page-enter">{children}</div>
      </div>

      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-ocean pb-[env(safe-area-inset-bottom)] md:hidden">
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={cn("relative flex flex-1 flex-col items-center gap-1 py-2 text-[0.62rem] font-semibold", active ? "text-white" : "text-white/45")}>
              <Icon name={item.icon} className="h-5 w-5" />
              {item.label.replace("Clear a shipment", "New")}
              {item.badge ? <span className="absolute right-1/4 top-1 rounded-full bg-coral px-1.5 text-[0.55rem] font-bold text-white">{item.badge}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
