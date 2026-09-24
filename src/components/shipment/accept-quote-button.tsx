"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

export function AcceptQuoteButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <FormError message={error} />
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/quotes/${quoteId}/accept`, { method: "POST" });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "We couldn't accept the quote. Try again.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Accepting…" : "Accept quote and get the invoice"}
      </Button>
    </div>
  );
}
