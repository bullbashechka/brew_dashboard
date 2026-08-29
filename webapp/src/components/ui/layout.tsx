import type { ElementType, ReactNode } from "react";

type SurfaceVariant = "default" | "subtle" | "critical";
type SurfacePadding = "default" | "compact";

const surfaceVariants: Record<SurfaceVariant, string> = {
  default:
    "border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-[var(--shadow-card)]",
  subtle:
    "border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] text-[var(--color-text)]",
  critical:
    "border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger)]",
};

const surfacePaddings: Record<SurfacePadding, string> = {
  default: "p-4 sm:p-5",
  compact: "p-4",
};

export function Surface({
  as: Component = "section",
  children,
  variant = "default",
  padding = "default",
  labelledBy,
  label,
}: {
  as?: ElementType;
  children: ReactNode;
  variant?: SurfaceVariant;
  padding?: SurfacePadding;
  labelledBy?: string;
  label?: string;
}) {
  return (
    <Component
      className={`min-w-0 rounded-xl border ${surfaceVariants[variant]} ${surfacePaddings[padding]}`}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Component>
  );
}

export function PageHeader({
  id,
  title,
  description,
  meta,
}: {
  id: string;
  title: ReactNode;
  description: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      <h1
        id={id}
        className="text-[1.625rem] leading-8 font-semibold tracking-tight text-[var(--color-text)] sm:text-3xl sm:leading-9"
      >
        {title}
      </h1>
      <p className="max-w-3xl text-[var(--color-text-secondary)]">{description}</p>
      {meta ? (
        <p className="text-sm text-[var(--color-text-muted)]" data-financial-value>
          {meta}
        </p>
      ) : null}
    </header>
  );
}

export function SectionHeading({
  id,
  title,
  description,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-xl leading-7 font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {description ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
      ) : null}
    </div>
  );
}
