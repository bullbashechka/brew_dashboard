import type { OverviewData, Profile } from "@brew-dashboard/contracts";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import { formatCurrency, formatNumber, localeFromProfile, translate } from "@/lib/i18n";
import { ChartAccessibility } from "@/components/ui/chart-accessibility";
import { ChartViewport } from "@/components/ui/chart-viewport";

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
  const formatTrendMoney = (value: string | null) =>
    value === null ? translate(locale, "comparison.notAvailable") : formatCurrency(value, profile);
  return (
    <figure
      className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:p-5"
      aria-labelledby="trend-title"
    >
      <figcaption
        id="trend-title"
        className="mb-4 flex flex-wrap items-center justify-between gap-2"
      >
        <span className="text-lg font-semibold text-[var(--color-text)]">
          {translate(locale, "overview.trend")}
        </span>
        <span className="text-sm text-[var(--color-text-secondary)]">
          {translate(locale, "comparison.versusPrevious")}
        </span>
      </figcaption>
      {data.trend.length ? (
        <ChartViewport size="trend" label={translate(locale, "overview.trend")}>
          <LineChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
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
              contentStyle={{
                background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-popover)",
              }}
              labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
              itemStyle={{ color: "var(--color-text-secondary)" }}
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
              stroke="var(--color-chart-1)"
              strokeWidth={2.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="grossProfit"
              stroke="var(--color-chart-2)"
              strokeWidth={2.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="comparisonRevenue"
              stroke="var(--color-chart-1)"
              strokeDasharray="6 4"
              strokeOpacity={0.55}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="comparisonGrossProfit"
              stroke="var(--color-chart-2)"
              strokeDasharray="6 4"
              strokeOpacity={0.55}
              dot={false}
            />
          </LineChart>
        </ChartViewport>
      ) : (
        <p className="py-12 text-center text-[var(--color-text-secondary)]">
          {translate(locale, "states.empty")}
        </p>
      )}
      <ChartAccessibility
        summary={`${translate(locale, "overview.trend")}. ${translate(locale, "comparison.versusPrevious")}`}
        caption={translate(locale, "overview.trend")}
        rows={data.trend}
        rowKey={(row) => row.bucket}
        columns={[
          {
            key: "period",
            header: translate(locale, "filters.period"),
            render: (row) => formatBucket(row.bucket),
          },
          {
            key: "revenue",
            header: labels.revenue,
            render: (row) => formatCurrency(row.revenue, profile),
          },
          {
            key: "grossProfit",
            header: labels.grossProfit,
            render: (row) => formatCurrency(row.grossProfit, profile),
          },
          {
            key: "comparisonRevenue",
            header: labels.comparisonRevenue,
            render: (row) => formatTrendMoney(row.comparisonRevenue),
          },
          {
            key: "comparisonGrossProfit",
            header: labels.comparisonGrossProfit,
            render: (row) => formatTrendMoney(row.comparisonGrossProfit),
          },
        ]}
      />
    </figure>
  );
}
