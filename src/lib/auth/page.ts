import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "./session";
import { can, type Capability } from "./rbac";

/**
 * The guard at the top of every private page. Signed out goes to sign in; signed
 * in without the capability gets a 404, so staff pages are not advertised to
 * customers. The middleware's cookie check is only a fast path in front of this.
 */
export async function pageUser(opts: { next: string; capability?: Capability }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(opts.next)}`);
  if (opts.capability && !can(user.role, opts.capability)) notFound();
  return user;
}
