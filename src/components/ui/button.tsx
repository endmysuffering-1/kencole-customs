import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Pill buttons in the familiar online-shop style. "primary" (yellow) is the main
 * thing to do on a page; "buy" (orange) is for committing money: accepting a
 * quote, paying. Yellow and orange never mark money itself; see tailwind.config.
 */
const VARIANTS = {
  primary: "bg-action text-ink ring-1 ring-inset ring-action-edge shadow-sm hover:bg-action-hover disabled:opacity-60",
  buy: "bg-buy text-ink ring-1 ring-inset ring-buy-edge shadow-sm hover:bg-buy-hover disabled:opacity-60",
  secondary: "bg-white text-ink ring-1 ring-inset ring-ink/20 shadow-sm hover:bg-paper disabled:text-ink-300",
  quiet: "text-ink-700 hover:bg-paper-sunk disabled:text-ink-300",
  danger: "bg-white text-alert ring-1 ring-inset ring-alert/40 hover:bg-alert-100",
} as const;

type Variant = keyof typeof VARIANTS;
const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed";

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
