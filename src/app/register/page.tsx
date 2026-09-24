import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/home";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-title font-bold">Create an account</h1>
      <p className="mt-2 text-ink-500">For a personal import or for your business. It takes a minute.</p>
      <RegisterForm initialType={type === "business" ? "business" : "personal"} />
    </main>
  );
}
