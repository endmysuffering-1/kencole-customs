"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";

export function SignOutButton({ className, children }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        router.push("/");
        router.refresh();
      }}
      className={cn("text-sm font-medium", className)}
    >
      {children ?? "Sign out"}
    </button>
  );
}
