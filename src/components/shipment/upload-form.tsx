"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { DOCUMENT_KIND } from "./labels";

export function UploadForm({ shipmentId, defaultKind = "COMMERCIAL_INVOICE", compact }: {
  shipmentId: string;
  defaultKind?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(defaultKind);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return setError("Choose a file first.");
    const form = new FormData();
    form.set("shipmentId", shipmentId);
    form.set("kind", kind);
    form.set("file", file);
    setBusy(true);
    setError(null);
    try {
      await api("/documents/upload", { form });
      if (input.current) input.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormError message={error} />
      <div className={compact ? "grid gap-3 sm:grid-cols-[12rem_1fr_auto]" : "space-y-3"}>
        <select aria-label="Document type" value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
          {Object.entries(DOCUMENT_KIND).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          ref={input} type="file" aria-label="File" required
          accept="application/pdf,image/jpeg,image/png,image/webp,.csv,.xls,.xlsx"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-paper-sunk file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-ink/10"
        />
        <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
      </div>
      <p className="text-xs text-ink-500">PDF, photo or spreadsheet, up to 20 MB.</p>
    </form>
  );
}
