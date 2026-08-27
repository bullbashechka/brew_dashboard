import type { Profile } from "@brew-dashboard/contracts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { formatPercent, localeFromProfile, translate } from "@/lib/i18n";

export function MetricComparison({
  change,
  profile,
  variant = "card",
}: {
  change: string | number | null;
  profile: Profile;
  variant?: "card" | "compact";
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
  const color =
    state === "up" ? "text-emerald-700" : state === "down" ? "text-red-700" : "text-stone-600";
  const compact = variant === "compact";

  return (
    <span
      className={`${compact ? "mt-1 gap-1 text-xs" : "mt-3 gap-1.5 text-sm"} flex items-center ${color}`}
      aria-label={label}
    >
      <Icon className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
      <span>{state === "na" ? label : magnitude}</span>
      {!compact && (
        <span className="text-stone-600">{translate(locale, "comparison.versusPrevious")}</span>
      )}
    </span>
  );
}
