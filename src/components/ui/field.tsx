import { cn } from "@/lib/cn";

export const inputClass =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-ink ring-1 ring-inset ring-ink/20 placeholder:text-ink-300 focus:ring-2 focus:ring-inset focus:ring-ink disabled:bg-paper-sunk";

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
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
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
    <p role="alert" className="rounded-md bg-alert-100 px-3 py-2 text-sm font-medium text-alert">
      {message}
    </p>
  );
}
