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
    <>
      <h1 className="text-[1.8rem] font-semibold tracking-tight text-ocean">Welcome back</h1>
      <p className="mt-1.5 text-sm text-ink-500">Sign in to track your shipments, approve quotes and see what you owe.</p>
      <LoginForm next={next} />
    </>
  );
}
