"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChargeBreakdown, type BreakdownCharge } from "@/components/charge-breakdown";
import { Field, inputClass } from "@/components/ui/field";
import { LinkButton } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client/api";

interface Estimate {
  goodsValue: string;
  customsValue: string;
  governmentTotal: string;
  brokerTotal: string;
  grandTotal: string;
  unclassifiedLines: number[];
  charges: { chargeCode: string; label: string; payee: "GOVERNMENT" | "BROKER"; amount: string; unverified: boolean }[];
  hsCode: { code: string; description: string } | null;
  hsCodeRecognised: boolean;
  permits: { agency: string; permit: string; notes: string | null }[];
}

type Code = { code: string; description: string };

/**
 * The public landed-cost calculator. Every figure comes from the server, which
 * prices from the rate table; nothing is calculated here. The result is an
 * estimate: customs assesses the real amount.
 */
export function Calculator() {
  const [goods, setGoods] = useState("500");
  const [freight, setFreight] = useState("60");
  const [insurance, setInsurance] = useState("");
  const [importType, setImportType] = useState<"PERSONAL" | "COMMERCIAL">("PERSONAL");
  const [delivery, setDelivery] = useState(false);
  const [what, setWhat] = useState("");
  const [picked, setPicked] = useState<Code | null>(null);
  const [matches, setMatches] = useState<Code[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const listId = useId();

  // Search the tariff as the visitor describes their goods.
  useEffect(() => {
    const q = what.trim();
    if (picked && q === `${picked.code} · ${picked.description}`) return;
    if (q.length < 2) return setMatches([]);
    const t = setTimeout(() => {
      api<{ codes: Code[] }>(`/hs-codes?q=${encodeURIComponent(q)}`).then((r) => setMatches(r.codes)).catch(() => setMatches([]));
    }, 200);
    return () => clearTimeout(t);
  }, [what, picked]);

  // Re-price whenever an input settles.
  useEffect(() => {
    if (!/^\d+(\.\d{1,2})?$/.test(goods.trim()) || Number(goods) <= 0) {
      setEstimate(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ estimate: Estimate }>("/estimate", {
          body: {
            goodsValue: goods.trim(),
            freightCost: freight.trim() || "0",
            insuranceCost: insurance.trim() || "0",
            importType,
            deliveryRequested: delivery,
            hsCode: picked?.code ?? "",
          },
        });
        if (n === seq.current) {
          setEstimate(r.estimate);
          setError(null);
        }
      } catch (err) {
        if (n === seq.current) setError(err instanceof ApiError ? err.message : "We couldn't price that. Try again.");
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [goods, freight, insurance, importType, delivery, picked]);

  const charges: BreakdownCharge[] =
    estimate?.charges.map((c) => ({ code: c.chargeCode, label: c.label, payee: c.payee, amount: c.amount, unverified: c.unverified })) ?? [];

  return (
    <div className="grid overflow-hidden rounded-card bg-paper-card text-ink shadow-card lg:grid-cols-[1fr_1.1fr]">
      <form className="space-y-4 p-6 sm:p-8" onSubmit={(e) => e.preventDefault()}>
        <h2 className="text-lg font-bold">What will it cost to clear?</h2>
        <Field label="What are you importing?" htmlFor="calc-what" hint={picked ? `Tariff heading ${picked.code}` : "Optional, but duty depends on it."}>
          <input
            id="calc-what"
            list={listId}
            value={what}
            onChange={(e) => {
              const v = e.target.value;
              setWhat(v);
              const hit = matches.find((m) => v === m.code || v === `${m.code} · ${m.description}`);
              setPicked(hit ?? null);
              if (hit) setWhat(`${hit.code} · ${hit.description}`);
            }}
            placeholder="e.g. laptop, t-shirts, rum"
            autoComplete="off"
            className={inputClass}
          />
          <datalist id={listId}>
            {matches.map((m) => <option key={m.code} value={`${m.code} · ${m.description}`} />)}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Price paid (USD)" htmlFor="calc-goods">
            <input id="calc-goods" inputMode="decimal" value={goods} onChange={(e) => setGoods(e.target.value)} className={`${inputClass} num`} />
          </Field>
          <Field label="Freight you paid (USD)" htmlFor="calc-freight">
            <input id="calc-freight" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} className={`${inputClass} num`} />
          </Field>
          <Field label="Insurance (USD)" htmlFor="calc-ins" hint="Leave blank if none.">
            <input id="calc-ins" inputMode="decimal" value={insurance} onChange={(e) => setInsurance(e.target.value)} className={`${inputClass} num`} />
          </Field>
          <Field label="For" htmlFor="calc-type">
            <select id="calc-type" value={importType} onChange={(e) => setImportType(e.target.value as "PERSONAL" | "COMMERCIAL")} className={inputClass}>
              <option value="PERSONAL">Personal</option>
              <option value="COMMERCIAL">Business</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} className="h-4 w-4 rounded border-ink/30 accent-ink focus:ring-ink" />
          Deliver it to me once it clears
        </label>
      </form>

      <div className="border-t border-ink/10 bg-white p-6 sm:p-8 lg:border-l lg:border-t-0" aria-live="polite">
        {error ? (
          <p role="alert" className="text-sm font-medium text-alert">{error}</p>
        ) : estimate ? (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ChargeBreakdown
              charges={charges}
              goodsValue={estimate.goodsValue}
              customsValue={estimate.customsValue}
              governmentTotal={estimate.governmentTotal}
              brokerTotal={estimate.brokerTotal}
              grandTotal={estimate.grandTotal}
            />
            {!estimate.hsCodeRecognised && (
              <p className="mt-4 text-sm text-ink-700">We don't recognise that tariff code, so this uses the general duty rate.</p>
            )}
            {estimate.unclassifiedLines.length > 0 && estimate.hsCodeRecognised && (
              <p className="mt-4 text-sm text-ink-700">
                Without knowing exactly what the goods are, this uses the general duty rate. Tell us what you're importing for a closer figure.
              </p>
            )}
            {estimate.permits.length > 0 && (
              <div className="mt-4 rounded-md bg-paper-sunk px-4 py-3 ring-1 ring-inset ring-ink/15 text-sm">
                <p className="font-semibold">You may need a permit first</p>
                <ul className="mt-1 list-disc pl-5">
                  {estimate.permits.map((p) => <li key={p.agency + p.permit}>{p.permit} from {p.agency}</li>)}
                </ul>
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              An estimate from list prices. Bahamas Customs assesses the final duty and VAT on your entry; a licensed broker
              reviews every shipment before we quote.
            </p>
            <LinkButton href="/register" className="mt-5 w-full">Start a shipment</LinkButton>
          </div>
        ) : (
          <p className="text-sm text-ink-500">Enter the price you paid to see an estimate.</p>
        )}
      </div>
    </div>
  );
}
