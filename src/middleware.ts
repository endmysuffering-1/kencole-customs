import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

/**
 * Runs on the Edge, where the database is out of reach, so it does only two
 * cheap things. It is not the access control: every page and route checks the
 * session and the record itself.
 *
 * 1. Refuses state-changing API calls from another origin. The session cookie
 *    is SameSite=Lax already; this is the second lock on the door.
 * 2. Sends a visitor with no session cookie to sign in before a private page
 *    renders, instead of flashing an empty dashboard.
 */

const PRIVATE_PAGES = ["/dashboard", "/shipments", "/ops", "/broker", "/admin"];
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Not a browser request; the cookie is what a forgery would need.
  if (origin === "null") return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (UNSAFE_METHODS.has(req.method) && !sameOrigin(req)) {
      return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    }
    return NextResponse.next();
  }

  const isPrivate = PRIVATE_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPrivate && !req.cookies.has(SESSION_COOKIE)) {
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
