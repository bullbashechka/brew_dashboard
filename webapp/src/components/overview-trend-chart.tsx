import type { OverviewData, Profile } from "@brew-dashboard/contracts";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency, formatNumber, localeFromProfile, translate } from "@/lib/i18n";

export function OverviewTrendChart({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const formatBucket = (bucket: string) => {
    if (data.period === "today") return `${bucket.slice(11, 13)}:00`;
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${bucket.slice(0, 10)}T12:00:00.000Z`));
  };
  const labels = {
    revenue: translate(locale, "metrics.revenue"),
    grossProfit: translate(locale, "metrics.grossProfit"),
    comparisonRevenue: `${translate(locale, "metrics.revenue")} · ${translate(locale, "overview.previousPeriod")}`,
    comparisonGrossProfit: `${translate(locale, "metrics.grossProfit")} · ${translate(locale, "overview.previousPeriod")}`,
  };
  return (
    <figure
      className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
      aria-labelledby="trend-title"
    >
      <figcaption
        id="trend-title"
        className="mb-4 flex flex-wrap items-center justify-between gap-2"
      >
        <span className="text-lg font-semibold text-stone-950">
          {translate(locale, "overview.trend")}
        </span>
        <span className="text-sm text-stone-600">
          {translate(locale, "comparison.versusPrevious")}
        </span>
      </figcaption>
      {data.trend.length ? (
        <div className="h-80 min-w-0" aria-label={translate(locale, "overview.trend")}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" />
              <XAxis
                dataKey="bucket"
                tickFormatter={formatBucket}
                minTickGap={28}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                tickFormatter={(value) => formatNumber(value, profile)}
                width={54}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                labelFormatter={(label) => formatBucket(String(label ?? ""))}
                formatter={(value, name) => [
                  formatCurrency(String(value ?? 0), profile),
                  labels[String(name) as keyof typeof labels] ?? String(name),
                ]}
              />
              <Legend
                formatter={(value) => labels[String(value) as keyof typeof labels] ?? String(value)}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="var(--chart-one)"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="grossProfit"
                stroke="var(--chart-two)"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="comparisonRevenue"
                stroke="var(--chart-one)"
                strokeDasharray="5 5"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="comparisonGrossProfit"
                stroke="var(--chart-two)"
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-12 text-center text-stone-600">{translate(locale, "states.empty")}</p>
      )}
    </figure>
  );
}
