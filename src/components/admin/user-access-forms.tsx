"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { ROLE_NAMES, ROLES } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/rbac";

/** Role and access for one account. Both need a reason, which goes in the audit log. */
export function UserAccessForms({ userId, role, active }: { userId: string; role: Role; active: boolean }) {
  const router = useRouter();
  const [nextRole, setRole] = useState<Role>(role);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"role" | "access" | null>(null);

  async function send(kind: "role" | "access") {
    setError(null);
    if (!reason.trim()) return setError("Give a reason. It is recorded in the audit log.");
    if (kind === "role" && nextRole === role) return setError("Choose a different role.");
    if (kind === "access" && active && !window.confirm("Deactivate this account? They will be signed out everywhere at once.")) return;
    setBusy(kind);
    try {
      await api(kind === "role" ? `/users/${userId}/role` : `/users/${userId}/access`, {
        body: kind === "role" ? { role: nextRole, reason: reason.trim() } : { active: !active, reason: reason.trim() },
      });
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That change wasn't saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-md bg-paper p-4">
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <Field label="Role" htmlFor={`role-${userId}`}>
          <select id={`role-${userId}`} value={nextRole} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
          </select>
        </Field>
        <Field label="Reason (required)" htmlFor={`why-${userId}`} hint="Recorded in the audit log under your name.">
          <input id={`why-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
        </Field>
      </div>
      {nextRole === "CUSTOMS_BROKER" && role !== "CUSTOMS_BROKER" && (
        <p className="text-sm text-alert">
          This role can approve classifications and submit entries to Bahamas Customs. Give it only to a licensed broker.
        </p>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => send("role")} disabled={busy !== null || nextRole === role}>
          {busy === "role" ? "Saving…" : "Change role"}
        </Button>
        <Button variant={active ? "danger" : "secondary"} onClick={() => send("access")} disabled={busy !== null}>
          {busy === "access" ? "Saving…" : active ? "Deactivate account" : "Restore account"}
        </Button>
      </div>
    </div>
  );
}
