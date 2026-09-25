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
    <>
      <h1 className="text-[1.8rem] font-semibold tracking-tight text-ocean">Create account</h1>
      <p className="mt-1.5 text-sm text-ink-500">For a personal import or for your business. It takes a minute.</p>
      <RegisterForm initialType={type === "business" ? "business" : "personal"} />
    </>
  );
}
