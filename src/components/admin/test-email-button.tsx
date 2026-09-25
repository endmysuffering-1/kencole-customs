"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

/** Sends the signed-in administrator one email, and says plainly whether it went. */
export function TestEmailButton() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ sentTo: string; delivered: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setSent(null);
    setError(null);
    try {
      setSent(await api<{ sentTo: string; delivered: boolean }>("/admin/test-email", { method: "POST" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The test email was not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" onClick={send} disabled={busy}>
        {busy ? "Sending…" : "Send me a test email"}
      </Button>
      {sent && (
        <p role="status" className={sent.delivered ? "text-success" : "text-ink-700"}>
          {sent.delivered
            ? `Sent to ${sent.sentTo}. Check that inbox, and its spam folder.`
            : "Written to the server log, not sent: no mail service is connected yet."}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
