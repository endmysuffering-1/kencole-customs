"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { homeFor } from "@/lib/auth/home";
import type { Role } from "@/lib/auth/rbac";

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: { role: Role } }>("/auth/login", {
        body: { email: form.get("email"), password: form.get("password") },
      });
      router.push(next ?? homeFor(user.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't sign you in. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <FormError message={error} />
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-ink-500">
        New to Kencole?{" "}
        <Link href="/register" className="font-semibold text-sky underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </form>
  );
}
