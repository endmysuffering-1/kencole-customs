import { cn } from "@/lib/cn";

export const inputClass =
  "block w-full rounded-field border-[1.5px] border-line-strong bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-300 transition focus:border-sky focus:outline-none focus:ring-[3px] focus:ring-sky/15 disabled:bg-paper-sunk";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | string[];
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </label>
      {children}
      {message ? (
        <p className="text-sm text-alert" role="alert">{message}</p>
      ) : hint ? (
        <p className="text-sm text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-field bg-alert-100 px-3.5 py-2.5 text-sm font-medium text-alert">
      {message}
    </p>
  );
}
