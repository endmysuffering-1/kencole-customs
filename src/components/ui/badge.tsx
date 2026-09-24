import { cn } from "@/lib/cn";

const TONES = {
  neutral: "bg-paper-sunk text-ink-700",
  ink: "bg-ink text-white",
  good: "bg-ink-700 text-white",
  warn: "bg-white text-alert ring-1 ring-inset ring-alert/40",
  alert: "bg-alert-100 text-alert",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", TONES[tone], className)}
      {...props}
    />
  );
}

/** Shown against any figure computed from a rate not yet confirmed against the Tariff Act. */
export function UnverifiedBadge() {
  return (
    <span
      title="This rate has not been confirmed against the current Tariff Act. Treat the figure as an estimate."
      className="inline-flex items-center rounded border border-dashed border-ink-500 px-1.5 py-px text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500"
    >
      Unverified rate
    </span>
  );
}
