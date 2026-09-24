"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

export function SignOutButton() {
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
      className="rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
    >
      Sign out
    </button>
  );
}
