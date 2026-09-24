import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { ROLE_NAMES, ROLES } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/rbac";
import { listUsers, recentAccessChanges } from "@/lib/services/user-service";
import { listUsersQuery } from "@/lib/validation/schemas";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { UserAccessForms } from "@/components/admin/user-access-forms";
import { date, dateTime, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const STAFF: Role[] = ["CUSTOMS_BROKER", "OPERATIONS", "DRIVER", "SUPER_ADMIN"];

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await pageUser({ next: "/admin/users", capability: "users:manage" });
  // An unset filter arrives as an empty string ("status="); drop those so one
  // blank field doesn't invalidate the rest of the search.
  const raw = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => v));
  const parsed = listUsersQuery.safeParse(raw);
  const filters = parsed.success ? parsed.data : {};
  const [{ users, nextCursor, roleCounts }, changes] = await Promise.all([
    listUsers(user, filters).then(toPlain),
    recentAccessChanges(user).then(toPlain),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: filters.q, role: filters.role, status: filters.status, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-title font-bold">Users</h1>
      <p className="mt-2 max-w-3xl text-ink-700">
        Every account, customer and staff. Role changes and deactivations need a reason and are recorded in the audit log.
        A deactivated account is signed out everywhere at once.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="Filter by role">
        <Link href={`/admin/users${qs({ role: undefined, cursor: undefined })}`} className={`rounded-full px-3 py-1 font-medium ${!filters.role ? "bg-ink text-white" : "bg-paper-card text-ink-700 shadow-card hover:bg-paper-sunk"}`}>
          Everyone
        </Link>
        {ROLES.map((r) => (
          <Link key={r} href={`/admin/users${qs({ role: r, cursor: undefined })}`} className={`rounded-full px-3 py-1 font-medium ${filters.role === r ? "bg-ink text-white" : "bg-paper-card text-ink-700 shadow-card hover:bg-paper-sunk"}`}>
            {ROLE_NAMES[r]} <span className="num opacity-70">{roleCounts[r] ?? 0}</span>
          </Link>
        ))}
      </nav>

      <form className="mt-4 flex flex-wrap gap-2" action="/admin/users">
        {filters.role && <input type="hidden" name="role" value={filters.role} />}
        <input name="q" defaultValue={filters.q} placeholder="Name or email" aria-label="Search by name or email" className={`${inputClass} max-w-xs`} />
        <div className="w-40">
          <select name="status" defaultValue={filters.status ?? ""} aria-label="Status" className={inputClass}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden">
          {users.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">No accounts match.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {users.map((u) => (
                <li key={u.id} className="px-5 py-3.5">
                  <div className="grid gap-2 text-sm sm:grid-cols-[1fr_10rem_9rem] sm:items-center">
                    <span>
                      <span className="font-semibold">{u.fullName}</span>
                      {u.self && <span className="ml-2 text-xs text-ink-500">(you)</span>}
                      <span className="block text-ink-500">{u.email}</span>
                      {u.businesses.length > 0 && (
                        <span className="block text-xs text-ink-500">
                          {u.businesses.map((b) => `${b.name}${b.isAdmin ? " (admin)" : ""}`).join(", ")}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={STAFF.includes(u.role) ? "ink" : "neutral"}>{ROLE_NAMES[u.role]}</Badge>
                      {!u.active && <Badge tone="alert">Deactivated</Badge>}
                    </span>
                    <span className="text-xs text-ink-500 sm:text-right">
                      Joined {date(u.createdAt)}
                      <span className="block">{u.lastSignIn ? `Signed in ${date(u.lastSignIn)}` : "Never signed in"}</span>
                    </span>
                  </div>
                  {!u.self && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-semibold text-ink underline decoration-ink-300 underline-offset-2">Change role or access</summary>
                      <div className="mt-3"><UserAccessForms userId={u.id} role={u.role} active={u.active} /></div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {nextCursor && (
            <div className="border-t border-ink/10 px-5 py-3 text-right">
              <Link href={`/admin/users${qs({ cursor: nextCursor })}`} className="text-sm font-semibold underline decoration-ink-300 underline-offset-2">Next page</Link>
            </div>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader title="Recent access changes" eyebrow="From the audit log" />
          {changes.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-ink/10 text-sm">
              {changes.map((c) => {
                const before = c.oldValue as { role?: Role } | null;
                const after = c.newValue as { role?: Role } | null;
                return (
                  <li key={c.id} className="px-5 py-3">
                    <span className="font-medium">{c.actor}</span>{" "}
                    {c.action === "user.role_changed" ? (
                      <>moved {c.subject} from {ROLE_NAMES[before!.role!]} to {ROLE_NAMES[after!.role!]}</>
                    ) : c.action === "user.deactivated" ? (
                      <>deactivated {c.subject}</>
                    ) : (
                      <>restored {c.subject}</>
                    )}
                    <span className="block text-ink-500">{c.reason}</span>
                    <span className="block text-xs text-ink-500">{dateTime(c.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
