import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * DockDrop-style buttons. "primary" (coral) is the main thing to do on a page;
 * "dark" (ocean) is a strong secondary; "secondary" is the outlined ghost.
 * "buy" is kept as a name for committing money (accept, pay) and is coral too.
 * Coral never marks money itself; see tailwind.config.
 */
const VARIANTS = {
  primary: "bg-coral text-white hover:bg-coral-600 hover:-translate-y-px disabled:opacity-60 disabled:translate-y-0",
  buy: "bg-coral text-white hover:bg-coral-600 hover:-translate-y-px disabled:opacity-60 disabled:translate-y-0",
  dark: "bg-ocean text-white hover:bg-ink-700 hover:-translate-y-px disabled:opacity-60",
  secondary: "bg-white text-ink-500 ring-[1.5px] ring-inset ring-line-strong hover:bg-paper-sunk hover:text-ocean disabled:text-ink-300",
  quiet: "text-ink-500 hover:bg-paper-sunk hover:text-ocean disabled:text-ink-300",
  danger: "bg-white text-alert ring-[1.5px] ring-inset ring-alert/40 hover:bg-alert-100",
} as const;

type Variant = keyof typeof VARIANTS;
const base =
  "inline-flex items-center justify-center gap-2 rounded-field px-5 py-2.5 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={cn(base, VARIANTS[variant], className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, VARIANTS[variant], className)} {...props} />;
}
