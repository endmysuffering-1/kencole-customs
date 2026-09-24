"use client";

import { useEffect, useId, useState } from "react";
import { inputClass } from "@/components/ui/field";
import { api } from "@/lib/client/api";

/** A tariff code field that searches the classification table as the broker types. */
export function HsCodeInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const listId = useId();
  const [codes, setCodes] = useState<{ code: string; description: string }[]>([]);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      api<{ codes: { code: string; description: string }[] }>(`/hs-codes?q=${encodeURIComponent(q)}`)
        .then((r) => setCodes(r.codes))
        .catch(() => setCodes([]));
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 6109.10.00 or 'shirts'"
        autoComplete="off"
        className={`${inputClass} num`}
      />
      <datalist id={listId}>
        {codes.map((c) => (
          <option key={c.code} value={c.code}>{c.description}</option>
        ))}
      </datalist>
    </>
  );
}
