"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { HsCodeInput } from "@/components/broker/hs-code-input";
import { api, ApiError } from "@/lib/client/api";
import { isPercentBasis, RateInputError, toInputRate, toStoredRate, type ChargeBasis } from "@/lib/domain/rates";

interface Existing {
  id: string;
  rate: string;
  minAmount: string | null;
  maxAmount: string | null;
  sourceNote: string | null;
}

/**
 * Changing a rate (with `rule`) or adding one for new goods (with `chargeTypeId`).
 * The screen works in the units people use; the rate is converted to its
 * stored form here, with the same helper the tests pin down.
 */
export function RateForm({
  basis, rule, chargeTypeId, showLimits,
}: {
  basis: ChargeBasis;
  rule?: Existing;
  chargeTypeId?: string;
  showLimits: boolean;
}) {
  const router = useRouter();
  const percent = isPercentBasis(basis);
  const [scope, setScope] = useState<"heading" | "chapter">("heading");
  const [hsCode, setHsCode] = useState("");
  const [chapter, setChapter] = useState("");
  const [rate, setRate] = useState(rule ? toInputRate(basis, rule.rate) : "");
  const [minAmount, setMin] = useState(rule?.minAmount ?? "");
  const [maxAmount, setMax] = useState(rule?.maxAmount ?? "");
  const [effectiveFrom, setFrom] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sourceNote, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = rule?.id ?? `new-${chargeTypeId}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let stored: string;
    try {
      stored = toStoredRate(basis, rate);
    } catch (err) {
      return setError(err instanceof RateInputError ? err.message : "Check the rate.");
    }
    if (!reason.trim()) return setError(rule ? "Say why this rate is changing." : "Say why this rate is being added.");
    if (confirmed && !sourceNote.trim()) {
      return setError("To mark a rate confirmed, cite the instrument you checked it against.");
    }
    const body = {
      rate: stored,
      minAmount: showLimits ? minAmount.trim() || null : rule?.minAmount ?? null,
      maxAmount: showLimits ? maxAmount.trim() || null : rule?.maxAmount ?? null,
      effectiveFrom,
      confirmed,
      sourceNote: sourceNote.trim() || null,
      reason: reason.trim(),
      ...(rule ? {} : { chargeTypeId, hsCode: scope === "heading" ? hsCode.trim() : null, chapter: scope === "chapter" ? chapter.trim() : null }),
    };
    setBusy(true);
    try {
      await api(rule ? `/rates/${rule.id}/supersede` : "/rates", { body });
      router.refresh();
      (e.target as HTMLFormElement).closest("details")?.removeAttribute("open");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The rate wasn't saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md bg-paper p-4">
      {!rule && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Applies to" htmlFor={`${id}-scope`}>
            <select id={`${id}-scope`} value={scope} onChange={(e) => setScope(e.target.value as "heading" | "chapter")} className={inputClass}>
              <option value="heading">One heading</option>
              <option value="chapter">A whole chapter</option>
            </select>
          </Field>
          {scope === "heading" ? (
            <Field label="Tariff heading" htmlFor={`${id}-hs`}>
              <HsCodeInput id={`${id}-hs`} value={hsCode} onChange={setHsCode} />
            </Field>
          ) : (
            <Field label="Chapter" htmlFor={`${id}-ch`} hint="Two digits, such as 84.">
              <input id={`${id}-ch`} value={chapter} onChange={(e) => setChapter(e.target.value)} maxLength={2} inputMode="numeric" className={`${inputClass} num`} />
            </Field>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={percent ? "Rate (%)" : "Amount ($)"} htmlFor={`${id}-rate`}>
          <input id={`${id}-rate`} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" required className={`${inputClass} num`} />
        </Field>
        {showLimits && (
          <>
            <Field label="Minimum ($)" htmlFor={`${id}-min`} hint="Blank for none.">
              <input id={`${id}-min`} value={minAmount} onChange={(e) => setMin(e.target.value)} inputMode="decimal" className={`${inputClass} num`} />
            </Field>
            <Field label="Maximum ($)" htmlFor={`${id}-max`} hint="Blank for none.">
              <input id={`${id}-max`} value={maxAmount} onChange={(e) => setMax(e.target.value)} inputMode="decimal" className={`${inputClass} num`} />
            </Field>
          </>
        )}
      </div>

      <Field label="Takes effect" htmlFor={`${id}-from`} hint="Midnight in Nassau on this date. Leave blank for immediately.">
        <input id={`${id}-from`} type="date" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} num sm:w-48`} />
      </Field>

      <fieldset className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink/30 accent-ink focus:ring-ink" />
          <span>
            I have checked this rate against the current Tariff Act or Customs Management Regulations
            <span className="block text-ink-500">Leave unticked if it still needs checking. It will show as unverified wherever it is used.</span>
          </span>
        </label>
        <Field label={confirmed ? "Source (required)" : "Source note"} htmlFor={`${id}-src`} hint={confirmed ? "The instrument, schedule and section." : rule?.sourceNote ? `Currently: ${rule.sourceNote}` : undefined}>
          <input id={`${id}-src`} value={sourceNote} onChange={(e) => setSource(e.target.value)} maxLength={500} className={inputClass} />
        </Field>
      </fieldset>

      <Field label="Reason for the change (required)" htmlFor={`${id}-why`} hint="Recorded in the audit log under your name.">
        <textarea id={`${id}-why`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
      </Field>

      <FormError message={error} />
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : rule ? "Save new rate" : "Add rate"}</Button>
    </form>
  );
}
