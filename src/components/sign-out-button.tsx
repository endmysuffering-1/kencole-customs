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
      className="rounded-sm px-2 py-1 leading-tight text-left ring-white/70 hover:ring-1"
    >
      <span className="hidden text-xs text-white/75 sm:block">Done?</span>
      <span className="block text-sm font-bold">Sign out</span>
    </button>
  );
}
