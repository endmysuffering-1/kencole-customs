"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { cents, money as dec, sum } from "@/lib/money";
import { money } from "@/lib/format";

interface Line { description: string; quantity: string; unitValue: string }
const blank: Line = { description: "", quantity: "1", unitValue: "" };
const lineTotal = (l: Line) => {
  try { return cents(dec(l.quantity || 0).times(dec(l.unitValue || 0))); } catch { return dec(0); }
};

export function NewShipmentForm() {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const goods = cents(sum(lines.map(lineTotal)));

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { shipment } = await api<{ shipment: { id: string } }>("/shipments", {
        body: {
          description: form.get("description"),
          supplierName: form.get("supplierName"),
          supplierCountry: String(form.get("supplierCountry") ?? "").toUpperCase(),
          originCountry: String(form.get("supplierCountry") ?? "").toUpperCase(),
          freightMode: form.get("freightMode"),
          trackingNumber: form.get("trackingNumber"),
          heldAt: form.get("heldAt"),
          deliveryRequested: form.get("handover") === "deliver",
          currency: form.get("currency"),
          freightCost: form.get("freightCost") || "0",
          insuranceCost: form.get("insuranceCost") || "0",
          goodsValue: goods.toFixed(2),
          items: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitValue: l.unitValue || "0" })),
        },
      });
      router.push(`/shipments/${shipment.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields);
      } else setError("We couldn't save the shipment. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-6">
      <FormError message={error} />

      <Card>
        <CardHeader title="Your goods" eyebrow="We clear goods that have already arrived in The Bahamas" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field
            label="Where are they now?" htmlFor="heldAt" className="sm:col-span-2" error={fields.heldAt}
            hint="The port, the airport cargo shed, or your courier's warehouse, as it appears on your arrival notice."
          >
            <input id="heldAt" name="heldAt" required minLength={3} maxLength={200} placeholder="e.g. Nassau Container Port" className={inputClass} />
          </Field>
          <Field label="Short description" htmlFor="description" className="sm:col-span-2" error={fields.description}>
            <input id="description" name="description" placeholder="e.g. Laptop for work" className={inputClass} />
          </Field>
          <Field label="Seller or supplier" htmlFor="supplierName" error={fields.supplierName}>
            <input id="supplierName" name="supplierName" placeholder="e.g. Amazon.com" className={inputClass} />
          </Field>
          <Field label="Bought from (country code)" htmlFor="supplierCountry" hint="Two letters, e.g. US" error={fields.supplierCountry}>
            <input id="supplierCountry" name="supplierCountry" maxLength={2} placeholder="US" className={inputClass} />
          </Field>
          <Field label="How it arrived" htmlFor="freightMode">
            <select id="freightMode" name="freightMode" defaultValue="AIR" className={inputClass}>
              <option value="AIR">By air</option>
              <option value="SEA">By sea</option>
              <option value="COURIER">Through a courier</option>
            </select>
          </Field>
          <Field label="Waybill, bill of lading or tracking number" htmlFor="trackingNumber" hint="Optional, but it speeds things up" error={fields.trackingNumber}>
            <input id="trackingNumber" name="trackingNumber" className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Items on the invoice" eyebrow="One line per product" />
        <div className="space-y-3 p-5">
          <div className="hidden grid-cols-[1fr_6rem_8rem_7rem_2rem] gap-3 text-xs font-semibold uppercase tracking-wider text-ink-500 sm:grid">
            <span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Line total</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_6rem_8rem_7rem_2rem] sm:items-center">
              <input
                aria-label={`Item ${i + 1} description`} required value={l.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="What it is, in plain words" className={`${inputClass} col-span-2 sm:col-span-1`}
              />
              <input aria-label={`Item ${i + 1} quantity`} required inputMode="decimal" value={l.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })} className={`${inputClass} num`} />
              <input aria-label={`Item ${i + 1} unit price`} required inputMode="decimal" value={l.unitValue}
                onChange={(e) => update(i, { unitValue: e.target.value })} placeholder="0.00" className={`${inputClass} num`} />
              <span className="num self-center text-right text-sm font-medium">{money(lineTotal(l).toFixed(2))}</span>
              <button type="button" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                className="h-8 w-8 rounded-md text-ink-500 hover:bg-paper-sunk disabled:opacity-30">×</button>
            </div>
          ))}
          {fields.items && <p className="text-sm text-alert">{fields.items[0]}</p>}
          <button type="button" onClick={() => setLines((ls) => [...ls, { ...blank }])} className="text-sm font-semibold text-ink underline underline-offset-2">
            + Add another item
          </button>
        </div>
        <div className="flex items-baseline justify-between border-t border-ink/10 px-5 py-4">
          <span className="font-medium">Goods value</span>
          <span className="num text-lg font-bold">{money(goods.toFixed(2))}</span>
        </div>
      </Card>

      <Card>
        <CardHeader title="Once it clears" />
        <fieldset className="grid gap-3 p-5 sm:grid-cols-2">
          <legend className="sr-only">Collection or delivery</legend>
          {[
            { value: "collect", title: "I'll collect it", body: "We'll tell you when it's released and what to bring." },
            { value: "deliver", title: "Deliver it to me", body: "We'll call to arrange the address and time. A delivery fee applies." },
          ].map((o) => (
            <label key={o.value} className="flex cursor-pointer gap-3 rounded-md p-4 ring-1 ring-inset ring-ink/15 has-[:checked]:ring-2 has-[:checked]:ring-ink">
              <input type="radio" name="handover" value={o.value} defaultChecked={o.value === "collect"} className="mt-1 h-4 w-4 border-ink/30 accent-ink focus:ring-ink" />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-sm text-ink-500">{o.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card>
        <CardHeader title="Freight and insurance you paid" eyebrow="Both are part of the customs value in The Bahamas" />
        <div className="grid gap-5 p-5 sm:grid-cols-3">
          <Field label="Currency" htmlFor="currency" hint="BSD is pegged 1:1 to USD">
            <select id="currency" name="currency" defaultValue="USD" className={inputClass}>
              <option value="USD">USD</option>
              <option value="BSD">BSD</option>
            </select>
          </Field>
          <Field label="Freight cost" htmlFor="freightCost" error={fields.freightCost}>
            <input id="freightCost" name="freightCost" inputMode="decimal" placeholder="0.00" className={`${inputClass} num`} />
          </Field>
          <Field label="Insurance" htmlFor="insuranceCost" error={fields.insuranceCost}>
            <input id="insuranceCost" name="insuranceCost" inputMode="decimal" placeholder="0.00" className={`${inputClass} num`} />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save and see the estimate"}</Button>
      </div>
    </form>
  );
}
