import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-card border border-ink/15 bg-paper-card shadow-sm", className)} {...props} />;
}

export function CardHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-4 border-b border-ink/10 px-5 py-4", className)}>
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">{eyebrow}</p>}
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {action}
    </header>
  );
}
