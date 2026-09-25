import { cn } from "@/lib/cn";

/** DockDrop-style pill: a tinted background, the tone's colour, and a dot. */
const TONES = {
  neutral: "bg-ink-500/10 text-ink-500",
  ink: "bg-ocean text-white",
  good: "bg-success-100 text-success",
  info: "bg-sky-100 text-sky",
  warn: "bg-warn-100 text-warn",
  action: "bg-coral-100 text-coral-600",
  alert: "bg-alert-100 text-alert",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  dot = true,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", TONES[tone], className)}
      {...props}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
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
