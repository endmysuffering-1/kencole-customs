import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-card border border-line bg-paper-card shadow-card", className)} {...props} />;
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
    <header className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ink-500">{eyebrow}</p>}
        <h2 className="font-serif text-lg font-semibold text-ocean">{title}</h2>
      </div>
      {action}
    </header>
  );
}
