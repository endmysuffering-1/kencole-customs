import type { Metadata } from "next";
import { pageUser } from "@/lib/auth/page";
import { can } from "@/lib/auth/rbac";
import { listRateTable } from "@/lib/services/rate-service";
import { BASIS_LABEL, formatRate, scopeLabel, type ChargeBasis } from "@/lib/domain/rates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, UnverifiedBadge } from "@/components/ui/badge";
import { RateForm } from "@/components/admin/rate-form";
import { date, dateTime, money, toPlain } from "@/lib/format";

export const metadata: Metadata = { title: "Rates" };
export const dynamic = "force-dynamic";

type Rule = {
  id: string; hsCode: string | null; hsDescription: string | null; chapter: string | null; rate: string;
  minAmount: string | null; maxAmount: string | null; effectiveFrom: string; effectiveTo: string | null;
  confirmed: boolean; sourceNote: string | null;
};

export default async function RatesPage() {
  const user = await pageUser({ next: "/admin/rates", capability: "rates:read" });
  const editable = can(user.role, "rates:edit");
  const { charges, recent } = toPlain(await listRateTable(user));
  const unverified = charges.flatMap((c) => c.current).filter((r) => !r.confirmed).length;
  // The audit log stores rates as fractions; read them back through their charge's basis.
  const ruleInfo = new Map(
    charges.flatMap((c) => [...c.current, ...c.scheduled, ...c.past].map((r) => [r.id, { label: c.label, basis: c.basis as ChargeBasis, scope: scopeLabel(r) }] as const)),
  );
  const inForce = charges.reduce((n, c) => n + c.current.length, 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-title font-bold">Rates</h1>
      <p className="mt-2 max-w-3xl text-ink-700">
        The government charges every estimate, quote and invoice is priced from. A rate is never edited: a change closes
        the current rule and opens a new one, so an entry is always recalculated on the rate it was assessed under.
        Kencole&apos;s own fees are set in pricing rules, not here.
      </p>

      <div className={`mt-6 rounded-card px-5 py-4 text-sm ${unverified ? "bg-alert-100 text-ink" : "bg-paper-card shadow-card"}`}>
        {unverified ? (
          <>
            <span className="num font-semibold">{unverified} of {inForce}</span> rates in force have not been confirmed against
            the Tariff Act. Every charge priced from them is shown to customers as unverified.
          </>
        ) : (
          <>Every rate in force has been confirmed against a cited instrument.</>
        )}
      </div>

      <div className="mt-8 space-y-6">
        {charges.map((c) => {
          const basis = c.basis as ChargeBasis;
          const showLimits = [...c.current, ...c.scheduled].some((r) => r.minAmount || r.maxAmount) || c.level === "SHIPMENT";
          return (
            <Card key={c.id}>
              <CardHeader
                eyebrow={<span className="num">{c.code}</span>}
                title={c.label}
                action={
                  <span className="flex flex-wrap justify-end gap-1.5">
                    <Badge>{BASIS_LABEL[basis]}</Badge>
                    <Badge>{c.level === "SHIPMENT" ? "once per entry" : "per line"}</Badge>
                    {!c.active && <Badge tone="alert">switched off</Badge>}
                  </span>
                }
              />
              {(c.description || c.baseIncludes.length > 0) && (
                <p className="border-b border-ink/10 px-5 py-3 text-sm text-ink-700">
                  {c.description}
                  {c.baseIncludes.length > 0 && <> Its base includes {c.baseIncludes.join(", ")}.</>}
                </p>
              )}

              <RuleTable rules={c.current} basis={basis} showLimits={showLimits} editable={editable} heading="In force" />
              {c.scheduled.length > 0 && (
                <RuleTable rules={c.scheduled} basis={basis} showLimits={showLimits} editable={editable} heading="Scheduled" />
              )}

              <div className="flex flex-col gap-3 border-t border-ink/10 px-5 py-4">
                {c.past.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-ink-700">Superseded ({c.past.length})</summary>
                    <ul className="mt-2 divide-y divide-ink/10 text-sm">
                      {c.past.map((r) => (
                        <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                          <span>{scopeLabel(r)} · <span className="num">{formatRate(basis, r.rate)}</span></span>
                          <span className="num text-ink-500">{date(r.effectiveFrom)} to {date(r.effectiveTo)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {editable && (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-ink">Add a rate for a heading or chapter</summary>
                    <p className="mt-2 text-sm text-ink-500">
                      The most specific rule wins: a heading beats its chapter, and a chapter beats the rate for all goods.
                    </p>
                    <div className="mt-3">
                      <RateForm basis={basis} chargeTypeId={c.id} showLimits={showLimits} />
                    </div>
                  </details>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8">
        <CardHeader title="Recent rate changes" eyebrow="From the audit log" />
        {recent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-ink/10 text-sm">
            {recent.map((a) => {
              const before = a.oldValue as { rate?: string } | null;
              const after = a.newValue as { ruleId?: string; rate?: string; confirmed?: boolean } | null;
              const info = after?.ruleId ? ruleInfo.get(after.ruleId) : undefined;
              const show = (rate?: string) => (rate && info ? formatRate(info.basis, rate) : rate);
              return (
                <li key={a.id} className="flex flex-wrap justify-between gap-4 px-5 py-3">
                  <span>
                    <span className="font-medium">{a.actor}</span>{" "}
                    {a.action === "rate.created" ? "added" : "changed"} {info ? <>{info.label}, {info.scope}</> : "a rate"}:{" "}
                    {a.action === "rate.created" ? (
                      <span className="num">{show(after?.rate)}</span>
                    ) : (
                      <><span className="num">{show(before?.rate)}</span> → <span className="num">{show(after?.rate)}</span></>
                    )}
                    {after?.confirmed === false && <span className="text-ink-500"> (unverified)</span>}
                    <span className="block text-ink-500">{a.reason}</span>
                  </span>
                  <span className="shrink-0 text-ink-500">{dateTime(a.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </main>
  );
}

function RuleTable({
  rules, basis, showLimits, editable, heading,
}: {
  rules: Rule[];
  basis: ChargeBasis;
  showLimits: boolean;
  editable: boolean;
  heading: string;
}) {
  return (
    <div className="px-5 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{heading}</h3>
      {rules.length === 0 ? (
        <p className="mt-2 text-sm text-alert">No rule in force. This charge is not being applied to anything.</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/10">
          {rules.map((r) => (
            <li key={r.id} className="py-3">
              <div className="grid gap-2 text-sm sm:grid-cols-[1fr_7rem_auto] sm:items-start">
                <span>
                  <span className="font-medium">{scopeLabel(r)}</span>
                  {r.hsDescription && <span className="block text-ink-500">{r.hsDescription}</span>}
                  <span className="block text-xs text-ink-500">
                    {heading === "Scheduled" ? "Starts" : "Since"} {date(r.effectiveFrom)}
                    {r.effectiveTo && <> · ends {date(r.effectiveTo)}</>}
                    {showLimits && (r.minAmount || r.maxAmount) && (
                      <> · <span className="num">min {r.minAmount ? money(r.minAmount) : "none"}, max {r.maxAmount ? money(r.maxAmount) : "none"}</span></>
                    )}
                  </span>
                </span>
                <span className="num text-base font-semibold sm:text-right">{formatRate(basis, r.rate)}</span>
                <span className="sm:text-right">
                  {r.confirmed ? <Badge tone="good" title={r.sourceNote ?? undefined}>Confirmed</Badge> : <UnverifiedBadge />}
                </span>
              </div>
              {r.sourceNote && <p className="mt-1 text-xs text-ink-500">{r.confirmed ? "Source: " : "Note: "}{r.sourceNote}</p>}
              {editable && r.effectiveTo && (
                <p className="mt-2 text-xs text-ink-500">A replacement is scheduled. To change what happens next, change the scheduled rate.</p>
              )}
              {editable && !r.effectiveTo && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-ink underline decoration-ink-300 underline-offset-2">Change this rate</summary>
                  <div className="mt-3">
                    <RateForm basis={basis} rule={r} showLimits={showLimits} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
