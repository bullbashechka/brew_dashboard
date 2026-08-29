import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  comparison,
}: {
  label: ReactNode;
  value: ReactNode;
  comparison?: ReactNode;
}) {
  return (
    <article className="min-h-36 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:p-5">
      <p className="text-sm leading-5 font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p
        className="mt-2 text-[1.75rem] leading-[2.125rem] font-semibold tracking-tight text-[var(--color-text)] sm:text-[2rem] sm:leading-[2.375rem]"
        data-financial-value
      >
        {value}
      </p>
      {comparison}
    </article>
  );
}
