import type { Metadata } from "next";
import { pageUser } from "@/lib/auth/page";
import { NewShipmentForm } from "./new-shipment-form";

export const metadata: Metadata = { title: "New shipment" };

export default async function NewShipmentPage() {
  await pageUser({ next: "/shipments/new", capability: "shipment:create" });
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-title font-bold">New shipment</h1>
      <p className="mt-1 text-ink-500">
        Enter what's on your supplier's invoice. We'll estimate the cost now and a licensed broker will check it.
      </p>
      <NewShipmentForm />
    </main>
  );
}
