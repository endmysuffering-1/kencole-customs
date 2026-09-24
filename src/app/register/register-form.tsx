"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { homeFor } from "@/lib/auth/home";
import type { Role } from "@/lib/auth/rbac";

export function RegisterForm() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { user } = await api<{ user: { role: Role } }>("/auth/register", {
        body: {
          fullName: form.get("fullName"),
          email: form.get("email"),
          phone: form.get("phone"),
          password: form.get("password"),
          accountType,
          companyName: form.get("companyName") ?? "",
        },
      });
      router.push(homeFor(user.role));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else {
        setError("We couldn't create your account. Try again.");
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <FormError message={error} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">This account is for</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["personal", "business"] as const).map((type) => (
            <label
              key={type}
              className={`cursor-pointer rounded-md px-3 py-2.5 text-sm ring-1 ring-inset ${accountType === type ? "bg-ink text-white ring-ink" : "bg-white ring-ink/20"}`}
            >
              <input type="radio" name="accountType" value={type} checked={accountType === type} onChange={() => setAccountType(type)} className="sr-only" />
              <span className="font-semibold">{type === "personal" ? "Me" : "My business"}</span>
              <span className={`block text-xs ${accountType === type ? "text-white/70" : "text-ink-500"}`}>
                {type === "personal" ? "Personal imports" : "Commercial imports"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {accountType === "business" && (
        <Field label="Company name" htmlFor="companyName" error={fields.companyName}>
          <input id="companyName" name="companyName" required className={inputClass} />
        </Field>
      )}
      <Field label="Full name" htmlFor="fullName" error={fields.fullName}>
        <input id="fullName" name="fullName" autoComplete="name" required className={inputClass} />
      </Field>
      <Field label="Email" htmlFor="email" error={fields.email}>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label="Phone" htmlFor="phone" hint="Optional. For delivery and customs updates." error={fields.phone}>
        <input id="phone" name="phone" type="tel" autoComplete="tel" className={inputClass} />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint="At least 12 characters, with upper and lower case and a number."
        error={fields.password}
      >
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} className={inputClass} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Creating your account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-ink-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-ink underline underline-offset-2">Sign in</Link>
      </p>
    </form>
  );
}
