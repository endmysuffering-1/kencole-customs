"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { CLASSIFICATION_TONE, classificationLabel } from "@/components/staff/classification";
import { HsCodeInput } from "./hs-code-input";

export interface ReviewLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  lineValue: string;
  originCountry: string | null;
  hsCode: string | null;
  hsDescription: string | null;
  suggestedHsCode: string | null;
  confidence: string | null;
  classificationStatus: string;
  brokerNote: string | null;
}

interface Suggestion { hsCode: string; description: string; confidence: number; source: string; rationale: string }

type Decision = "APPROVE" | "MODIFY" | "EXCEPTION";

/**
 * One line, one licensed decision. The code on the table is whatever the line
 * already carries, else the machine's suggestion. Approving that code needs no
 * reason; anything else does, and the server enforces the same rule.
 */
export function LineDecision({ line, money }: { line: ReviewLine; money: string }) {
  const router = useRouter();
  // Mirrors the server: the line's code, else its stored suggestion. Loading
  // suggestions stores the top one on an unclassified line, so it becomes the
  // proposal here too.
  const [proposed, setProposed] = useState(line.hsCode ?? line.suggestedHsCode ?? "");
  const [code, setCode] = useState(proposed);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(line.brokerNote ?? "");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [open, setOpen] = useState(line.classificationStatus !== "BROKER_APPROVED");

  const changed = code.trim() !== proposed;
  const needsReason = (d: Decision) => d !== "APPROVE" || (proposed !== "" && changed);

  async function decide(decision: Decision) {
    const hsCode = code.trim();
    if (!hsCode) return setError("Enter a tariff code.");
    // An approval of a different code is a modification, and is recorded as one.
    const sent: Decision = decision === "APPROVE" && changed && proposed ? "MODIFY" : decision;
    if (needsReason(sent) && reason.trim().length < 4) {
      return setError(
        sent === "EXCEPTION"
          ? "Say why this line is an exception."
          : `Give a reason for using ${hsCode} instead of ${proposed}.`,
      );
    }
    setBusy(decision);
    setError(null);
    try {
      await api("/classification/decisions", {
        body: { itemId: line.id, hsCode, decision: sent, reason: reason.trim() || undefined, note: note.trim() || undefined },
      });
      setReason("");
      router.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.reason?.[0] ?? err.message) : "The decision wasn't saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function loadSuggestions() {
    try {
      const r = await api<{ suggestions: Suggestion[] }>("/classification/suggestions", { body: { itemId: line.id } });
      setSuggestions(r.suggestions);
      const top = r.suggestions[0];
      if (top && !proposed && line.classificationStatus === "UNCLASSIFIED") {
        setProposed(top.hsCode);
        if (!code) setCode(top.hsCode);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load suggestions.");
    }
  }

  return (
    <li className="px-5 py-4">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-4 text-left" aria-expanded={open}>
        <span>
          <span className="num mr-2 text-ink-500">{line.lineNumber}.</span>
          <span className="font-medium">{line.description}</span>
          <span className="num mt-0.5 block text-sm text-ink-500">
            {Number(line.quantity)} × · {money}{line.originCountry ? ` · origin ${line.originCountry}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {line.hsCode && <span className="num text-sm font-semibold">{line.hsCode}</span>}
          <Badge tone={CLASSIFICATION_TONE[line.classificationStatus as keyof typeof CLASSIFICATION_TONE] ?? "neutral"}>
            {classificationLabel(line.classificationStatus)}
          </Badge>
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 rounded-md bg-paper p-4">
          <div className="text-sm">
            {line.suggestedHsCode ? (
              <p>
                Suggested <span className="num font-semibold">{line.suggestedHsCode}</span>
                {line.confidence != null && <span className="text-ink-500"> at {Math.round(Number(line.confidence) * 100)}% confidence</span>}.
                {" "}The suggestion is a starting point, not a classification.
              </p>
            ) : (
              <p className="text-ink-500">No suggestion on file.</p>
            )}
            {suggestions === null ? (
              <button type="button" onClick={loadSuggestions} className="mt-1 text-sm font-semibold text-ink underline decoration-ink-300 underline-offset-2 hover:decoration-ink">Show suggestions and reasoning</button>
            ) : suggestions.length === 0 ? (
              <p className="mt-1 text-ink-500">Nothing to suggest for this description.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {suggestions.map((s) => (
                  <li key={s.hsCode + s.source}>
                    <button type="button" onClick={() => setCode(s.hsCode)} className="num font-semibold text-ink underline decoration-ink-300 underline-offset-2 hover:decoration-ink">{s.hsCode}</button>
                    <span className="text-ink-700"> {s.description}</span>
                    <span className="block text-xs text-ink-500">{Math.round(s.confidence * 100)}% · {s.source.toLowerCase().replaceAll("_", " ")} · {s.rationale}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tariff code" htmlFor={`code-${line.id}`} hint={line.hsDescription ?? undefined}>
              <HsCodeInput id={`code-${line.id}`} value={code} onChange={setCode} />
            </Field>
            <Field label="Note on the line (optional)" htmlFor={`note-${line.id}`}>
              <input id={`note-${line.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputClass} />
            </Field>
          </div>
          <Field
            label={changed && proposed ? `Reason for changing from ${proposed} (required)` : "Reason (required to modify or raise an exception)"}
            htmlFor={`reason-${line.id}`}
            hint="Recorded in the audit log under your name."
          >
            <textarea id={`reason-${line.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
          </Field>

          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide("APPROVE")} disabled={busy !== null}>
              {busy === "APPROVE" ? "Saving…" : changed && proposed ? `Approve ${code.trim() || "code"} (change)` : "Approve"}
            </Button>
            <Button variant="secondary" onClick={() => decide("MODIFY")} disabled={busy !== null}>
              {busy === "MODIFY" ? "Saving…" : "Modify"}
            </Button>
            <Button variant="danger" onClick={() => decide("EXCEPTION")} disabled={busy !== null}>
              {busy === "EXCEPTION" ? "Saving…" : "Raise exception"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
