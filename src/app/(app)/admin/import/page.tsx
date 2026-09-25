import type { Metadata } from "next";
import Link from "next/link";
import { pageUser } from "@/lib/auth/page";
import { can } from "@/lib/auth/rbac";
import { IMPORT_KIND_LIST, IMPORT_KINDS, isImportKind } from "@/lib/services/reference-import";
import { Card, CardHeader } from "@/components/ui/card";
import { ImportForm } from "@/components/admin/import-form";

export const metadata: Metadata = { title: "Import data" };
export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await pageUser({ next: "/admin/import", capability: "rates:edit" });
  const kinds = IMPORT_KIND_LIST.filter((k) => can(user.role, IMPORT_KINDS[k].capability));
  const asked = (await searchParams).kind ?? "";
  const kind = isImportKind(asked) && kinds.includes(asked) ? asked : kinds[0]!;
  const info = IMPORT_KINDS[kind];

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="sr-only">Import data</h1>
      <p className="max-w-3xl text-ink-700">
        Load tariff codes, rates, fees and permits from a spreadsheet. Download what is here now, edit it in Excel or
        Google Sheets, save it as CSV and upload it. You see every change before anything is saved, and nothing is
        saved if any row has a problem.
      </p>

      <nav aria-label="What to import" className="mt-5 flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Link
            key={k}
            href={`/admin/import?kind=${k}`}
            aria-current={k === kind ? "page" : undefined}
            className={
              k === kind
                ? "rounded-full bg-ocean px-3.5 py-1.5 text-sm font-semibold text-white"
                : "rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 ring-1 ring-inset ring-line-strong hover:text-ocean"
            }
          >
            {IMPORT_KINDS[k].title}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <ImportForm key={kind} kind={kind} title={info.title} />

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader eyebrow="Step 1" title="Start from what is here" />
            <div className="space-y-3 p-5 text-sm text-ink-700">
              <p>{info.summary}</p>
              <a
                href={`/api/v1/reference/${kind}/export`}
                className="inline-flex items-center gap-2 font-semibold text-sky hover:underline"
                download
              >
                Download {info.title.toLowerCase()} (CSV) ↓
              </a>
              <p className="text-ink-500">The download has the right columns, so it doubles as the template.</p>
            </div>
          </Card>
          <Card>
            <CardHeader eyebrow="The columns" title={info.title} />
            <dl className="divide-y divide-line text-sm">
              {info.columns.map((c) => (
                <div key={c.key} className="px-5 py-2.5">
                  <dt className="font-mono text-[0.8rem] font-semibold text-ocean">
                    {c.key}
                    {c.required && <span className="ml-1.5 font-sans text-xs font-medium text-coral-600">required</span>}
                  </dt>
                  <dd className="text-ink-500">{c.help}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>
    </main>
  );
}
