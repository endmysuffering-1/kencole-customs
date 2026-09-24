import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { homeFor, safeNext } from "@/lib/auth/home";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const user = await getSessionUser();
  if (user) redirect(next ?? homeFor(user.role));

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-title font-bold">Sign in</h1>
      <p className="mt-2 text-ink-500">Track your shipments, approve quotes and see what you owe.</p>
      <LoginForm next={next} />
    </main>
  );
}
