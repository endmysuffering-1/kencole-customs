"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client/api";

/** A one-click POST to the API, then a refresh. The server decides whether it is allowed. */
export function ActionButton({
  path, body, children, confirm, variant = "secondary", className,
}: {
  path: string;
  body?: unknown;
  children: React.ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant={variant}
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError(null);
          try {
            await api(path, { method: "POST", body: body ?? {} });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "That didn't work. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </Button>
      {error && <span role="alert" className="max-w-xs text-xs font-medium text-alert">{error}</span>}
    </span>
  );
}
