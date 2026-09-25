import { getSessionUser } from "@/lib/auth/session";
import { AppShell } from "./app-shell";
import { PublicHeader } from "./public-header";
import { SiteFooter } from "@/components/site-footer";

/** For pages anyone may use (search, the calculator): the app frame when signed in, the public one otherwise. */
export async function AdaptiveShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user) return <AppShell>{children}</AppShell>;
  return (
    <>
      <PublicHeader />
      {children}
      <SiteFooter />
    </>
  );
}
