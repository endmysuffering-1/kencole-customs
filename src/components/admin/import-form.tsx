"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import type { ImportKind, ImportPreview, RowAction } from "@/lib/services/reference-import";

const ACTION: Record<RowAction, { label: string; tone: BadgeTone }> = {
  error: { label: "Problem", tone: "alert" },
  remove: { label: "Remove", tone: "warn" },
  change: { label: "Change", tone: "info" },
  create: { label: "Add", tone: "good" },
  unchanged: { label: "No change", tone: "neutral" },
};

const SHOWN = 300;

/** Upload, check, then apply with a reason. The same file is sent both times and checked again on apply. */
export function ImportForm({ kind, title }: { kind: ImportKind; title: string }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState<ImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setPreview(null);
    setApplied(null);
    const picked = e.target.files?.[0];
    if (!picked) return setFile(null);
    if (/\.xlsx?$/i.test(picked.name)) {
      setFile(null);
      return setError("That is an Excel workbook. In Excel choose File › Save As › CSV (comma delimited), then upload the .csv file.");
    }
    if (picked.size > 4_000_000) {
      setFile(null);
      return setError("That file is larger than 4 MB. Split it into smaller files.");
    }
    setFile({ name: picked.name, csv: await picked.text() });
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a CSV file first.");
    setError(null);
    setApplied(null);
    setBusy("check");
    try {
      setPreview(await api<ImportPreview>(`/reference/${kind}/import`, { body: { csv: file.csv } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The file wasn't checked. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!file || !preview) return;
    if (!reason.trim()) return setError("Say why you are importing this file. It is recorded in the audit log.");
    setError(null);
    setBusy("apply");
    try {
      const done = await api<ImportPreview>(`/reference/${kind}/import`, { body: { csv: file.csv, apply: true, reason: reason.trim() } });
      setApplied(done);
      setPreview(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nothing was saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const c = preview?.counts;
  const changes = c ? c.create + c.change + c.remove : 0;

  return (
    <div className="min-w-0 space-y-6">
      <Card>
        <CardHeader eyebrow="Step 2" title={`Upload ${title.toLowerCase()}`} />
        <form onSubmit={check} className="space-y-4 p-5">
          <Field label="CSV file" htmlFor="import-file" hint="Save your sheet as CSV (comma delimited). The first row holds the column names.">
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={choose}
              className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-paper-sunk file:px-3 file:py-1 file:text-sm file:font-semibold file:text-ocean`}
            />
          </Field>
          <FormError message={error} />
          <Button type="submit" variant="dark" disabled={!file || busy !== null}>
            {busy === "check" ? "Checking…" : "Check the file"}
          </Button>
        </form>
      </Card>

      {applied && (
        <div role="status" className="rounded-card bg-success-100 px-5 py-4 text-sm text-ink">
          <p className="font-semibold text-success">Imported.</p>
          <p className="mt-1">
            <span className="num">{applied.counts.create}</span> added, <span className="num">{applied.counts.change}</span> changed,{" "}
            <span className="num">{applied.counts.remove}</span> removed and <span className="num">{applied.counts.unchanged}</span> left as they were.
            Each change is in the audit log with your reason.
          </p>
        </div>
      )}

      {preview && c && (
        <Card>
          <CardHeader eyebrow="Step 3" title={file ? `What ${file.name} would do` : "What the file would do"} />
          <div className="space-y-4 p-5">
            {preview.fileErrors.length > 0 ? (
              <ul className="space-y-1.5">
                {preview.fileErrors.map((m) => <li key={m}><FormError message={m} /></li>)}
              </ul>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(["error", "create", "change", "remove", "unchanged"] as RowAction[]).map((a) =>
                  c[a] > 0 ? (
                    <Badge key={a} tone={ACTION[a].tone}>
                      <span className="num">{c[a].toLocaleString("en-US")}</span>&nbsp;{a === "error" ? (c[a] === 1 ? "row with a problem" : "rows with problems") : `${ACTION[a].label.toLowerCase()}`}
                    </Badge>
                  ) : null,
                )}
              </div>
            )}

            {c.error > 0 && (
              <p className="text-sm text-ink-700">
                Nothing can be saved until every problem is fixed. Correct the rows below in your spreadsheet, save it as CSV
                again and check it once more.
              </p>
            )}
            {preview.fileErrors.length === 0 && c.error === 0 && changes === 0 && (
              <p className="text-sm text-ink-700">Everything in the file matches what is already here. There is nothing to import.</p>
            )}

            {preview.rows.length > 0 && (
              <div className="overflow-x-auto rounded-field border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-paper-sunk text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">What</th>
                      <th className="px-3 py-2">For</th>
                      <th className="px-3 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.rows.slice(0, SHOWN).map((r, i) => (
                      <tr key={`${r.line}-${i}`} className="align-top">
                        <td className="num px-3 py-2 text-ink-500">{r.line ?? "—"}</td>
                        <td className="px-3 py-2"><Badge tone={ACTION[r.action].tone}>{ACTION[r.action].label}</Badge></td>
                        <td className="px-3 py-2 font-medium text-ink">{r.label}</td>
                        <td className="px-3 py-2 text-ink-700">
                          {r.errors.length ? (
                            <ul className="space-y-0.5 text-alert">{r.errors.map((m) => <li key={m}>{m}</li>)}</ul>
                          ) : (
                            r.detail
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > SHOWN && (
                  <p className="border-t border-line px-3 py-2 text-sm text-ink-500">
                    And <span className="num">{(preview.rows.length - SHOWN).toLocaleString("en-US")}</span> more.
                  </p>
                )}
              </div>
            )}

            {preview.canApply && (
              <div className="space-y-3 rounded-field bg-paper p-4">
                <Field label="Why are you importing this?" htmlFor="import-reason" hint="Recorded in the audit log against every change, such as “2026 tariff schedule, checked against the Tariff Act”.">
                  <input id="import-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={1000} />
                </Field>
                <Button type="button" onClick={apply} disabled={busy !== null}>
                  {busy === "apply" ? "Saving…" : `Apply ${changes.toLocaleString("en-US")} ${changes === 1 ? "change" : "changes"}`}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
