import type { ReactNode } from "react";

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  accent:
    "border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-active)]",
  success:
    "border-[var(--color-success-border)] bg-[var(--color-success-surface)] text-[var(--color-success)]",
  warning:
    "border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] text-[var(--color-warning)]",
  danger:
    "border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger)]",
  info: "border-[var(--color-info-border)] bg-[var(--color-info-surface)] text-[var(--color-info)]",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs leading-4 font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
