import Link from "next/link";
import { cn } from "@/lib/cn";

const VARIANTS = {
  primary: "bg-ink text-white hover:bg-ink-700 disabled:bg-ink-300",
  secondary: "bg-white text-ink ring-1 ring-inset ring-ink/15 hover:bg-paper-sunk disabled:text-ink-300",
  quiet: "text-ink-700 hover:bg-paper-sunk disabled:text-ink-300",
  danger: "bg-white text-alert ring-1 ring-inset ring-alert/40 hover:bg-alert-100",
} as const;

type Variant = keyof typeof VARIANTS;
const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed";

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
