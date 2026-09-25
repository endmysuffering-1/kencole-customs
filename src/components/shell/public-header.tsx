import Image from "next/image";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/home";

const LINKS = [
  { href: "/#estimate", label: "Estimate duty" },
  { href: "/#how", label: "How it works" },
  { href: "/register?type=business", label: "Business accounts" },
];

/** The public pages' header, on ocean blue. Signed-in visitors get a way back to their account. */
export async function PublicHeader() {
  const user = await getSessionUser();
  return (
    <header className="bg-ocean text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="Kencole Customs Brokerage, home" className="shrink-0">
          {/* White on blue: the logo's gold would read as a button colour. See design/brand/. */}
          <Image src="/brand/kencole-wordmark-white-small.png" alt="" width={1308} height={489} priority className="h-10 w-auto" />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-field px-3 py-2 text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <Link href={homeFor(user.role)} className="rounded-field bg-coral px-4 py-2 text-sm font-semibold text-white hover:bg-coral-600">
              Your account →
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-field px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white">Sign in</Link>
              <Link href="/register" className="rounded-field bg-coral px-4 py-2 text-sm font-semibold text-white hover:bg-coral-600">Create account</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
