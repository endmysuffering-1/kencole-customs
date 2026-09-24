"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

export interface StatusOption {
  to: string;
  label: string;
  /** Shown instead of a button when this user may not make the move. */
  blockedBecause?: string;
}

/** Moves a shipment on. Guards live in the service; this only offers the legal next steps. */
export function StatusActions({ shipmentId, options }: { shipmentId: string; options: StatusOption[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) return <p className="text-sm text-ink-500">This shipment is closed.</p>;

  async function move(to: string) {
    if (to === "CANCELLED" && !window.confirm("Cancel this shipment? Unpaid invoices will be voided.")) return;
    setBusy(to);
    setError(null);
    try {
      await api(`/shipments/${shipmentId}/transitions`, { body: { to, note: note.trim() || undefined } });
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <input
        aria-label="Note for the history (optional)"
        placeholder="Note for the history (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        className={inputClass}
      />
      <div className="flex flex-wrap gap-2">
        {options.map((o) =>
          o.blockedBecause ? (
            <span key={o.to} title={o.blockedBecause} className="inline-flex cursor-not-allowed items-center rounded-md px-4 py-2 text-sm font-semibold text-ink-300 ring-1 ring-inset ring-ink/10">
              {o.label} · broker only
            </span>
          ) : (
            <Button
              key={o.to}
              variant={o.to === "CANCELLED" ? "danger" : "secondary"}
              disabled={busy !== null}
              onClick={() => move(o.to)}
            >
              {busy === o.to ? "Moving…" : `→ ${o.label}`}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
