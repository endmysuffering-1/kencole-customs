import { cn } from "@/lib/cn";

export interface Milestone {
  key: string;
  label: string;
  state: "done" | "active" | "pending";
}

/** The customer's timeline: the six plain-language milestones from shipment-state.ts. */
export function Milestones({ milestones, cancelled }: { milestones: Milestone[]; cancelled?: boolean }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-6 sm:gap-0" aria-label="Progress">
      {milestones.map((m, i) => (
        <li key={m.key} className="relative flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                "absolute left-[-50%] right-[50%] top-3 hidden h-0.5 sm:block",
                m.state === "pending" ? "bg-line-strong" : "bg-success",
              )}
            />
          )}
          <span
            className={cn(
              "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ring-4 ring-paper-card",
              m.state === "done" && "bg-success text-white",
              m.state === "active" && "bg-sky-100 text-sky ring-2 ring-sky",
              m.state === "pending" && "bg-paper-sunk text-ink-300",
            )}
          >
            {m.state === "done" ? "✓" : i + 1}
          </span>
          <span
            className={cn(
              "text-sm sm:pr-2",
              m.state === "active" ? "font-semibold text-ink" : m.state === "done" ? "text-ink-700" : "text-ink-300",
            )}
          >
            {m.label}
            {m.state === "active" && !cancelled && <span className="sr-only"> (current)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
