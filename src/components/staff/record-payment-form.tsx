"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

/** Staff record money that has actually arrived. Nothing here takes a payment. */
export function RecordPaymentForm({ invoiceId, outstanding }: { invoiceId: string; outstanding: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(outstanding);
  const [provider, setProvider] = useState("bank_transfer");
  const [providerRef, setProviderRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/invoices/${invoiceId}/payments`, {
            body: { amount, provider, providerRef: providerRef.trim() || undefined },
          });
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "The payment wasn't recorded. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormError message={error} />
      <div className="grid gap-2 sm:grid-cols-[7rem_9rem_1fr_auto]">
        <input aria-label="Amount received" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} num text-right`} />
        <select aria-label="How it was paid" value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
          <option value="bank_transfer">Bank transfer</option>
          <option value="manual">Cash / cheque</option>
          <option value="card">Card terminal</option>
          <option value="credit">Account credit</option>
        </select>
        <input aria-label="Bank or receipt reference" placeholder="Bank or receipt reference" value={providerRef} onChange={(e) => setProviderRef(e.target.value)} maxLength={120} className={inputClass} />
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record"}</Button>
      </div>
    </form>
  );
}
