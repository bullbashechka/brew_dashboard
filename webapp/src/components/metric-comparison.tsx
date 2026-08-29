import type { Profile } from "@brew-dashboard/contracts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { formatPercent, localeFromProfile, translate } from "@/lib/i18n";

export function MetricComparison({
  change,
  profile,
  variant = "card",
  effect = "direct",
}: {
  change: string | number | null;
  profile: Profile;
  variant?: "card" | "compact";
  effect?: "direct" | "inverse" | "neutral";
}) {
  const locale = localeFromProfile(profile);
  const numericChange = change === null ? null : Number(change);
  const state =
    numericChange === null ? "na" : numericChange > 0 ? "up" : numericChange < 0 ? "down" : "flat";
  const magnitude = numericChange === null ? null : formatPercent(Math.abs(numericChange), profile);
  const Icon = state === "up" ? ArrowUp : state === "down" ? ArrowDown : Minus;
  const label =
    state === "na"
      ? translate(locale, "comparison.notAvailable")
      : state === "up"
        ? translate(locale, "comparison.increase", { value: magnitude! })
        : state === "down"
          ? translate(locale, "comparison.decrease", { value: magnitude! })
          : translate(locale, "comparison.unchanged");
  const beneficial =
    effect === "neutral"
      ? null
      : (state === "up" && effect === "direct") || (state === "down" && effect === "inverse");
  const harmful =
    effect === "neutral"
      ? null
      : (state === "down" && effect === "direct") || (state === "up" && effect === "inverse");
  const color = beneficial
    ? "text-[var(--color-success)]"
    : harmful
      ? "text-[var(--color-danger)]"
      : "text-[var(--color-text-muted)]";
  const compact = variant === "compact";

  return (
    <span
      className={`${compact ? "mt-1 gap-1 text-xs" : "mt-3 gap-1.5 text-sm"} flex items-center ${color}`}
      aria-label={label}
    >
      <Icon className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
      <span>{state === "na" ? label : magnitude}</span>
      {!compact && (
        <span className="text-[var(--color-text-muted)]">
          {translate(locale, "comparison.versusPrevious")}
        </span>
      )}
    </span>
  );
}
