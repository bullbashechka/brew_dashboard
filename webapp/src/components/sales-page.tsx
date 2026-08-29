import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Profile, SalesData } from "@brew-dashboard/contracts";
import type { ReactNode } from "react";
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

import { salesInfiniteQuery, type AnalyticsFilters } from "@/api/analytics";
import { MetricComparison } from "@/components/metric-comparison";
import { sessionQueryOptions } from "@/api/session";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { ChartAccessibility } from "@/components/ui/chart-accessibility";
import { CachedSnapshotWarning, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
  type TranslationKey,
} from "@/lib/i18n";

const metricNames = [
  "revenue",
  "cogs",
  "grossProfit",
  "grossMargin",
  "orders",
  "averageCheck",
] as const;

export function SalesPage({ filters }: { filters: AnalyticsFilters }) {
  const { data: profile } = useQuery(sessionQueryOptions());
  const analytics = useInfiniteQuery({
    ...salesInfiniteQuery(profile?.networkId ?? "pending", filters),
    enabled: Boolean(profile),
  });
  const locale = localeFromProfile(profile);

  if (!profile || analytics.isPending) return <SalesSkeleton />;
  if (analytics.isLoadingError || !analytics.data)
    return (
      <SalesFrame profile={profile}>
        <ErrorState
          locale={locale}
          error={analytics.error}
          onRetry={() => void analytics.refetch()}
        />
      </SalesFrame>
    );

  const first = analytics.data.pages[0];
  if (!first)
    return (
      <SalesFrame profile={profile}>
        <EmptyState locale={locale} />
      </SalesFrame>
    );
  const orders = analytics.data.pages.flatMap((page) => page.data.recentOrders);
  return (
    <SalesFrame profile={profile} updatedAt={first.meta.asOf}>
      {analytics.isRefetchError && (
        <CachedSnapshotWarning
          profile={profile}
          error={analytics.error}
          asOf={first.meta.asOf}
          onRetry={() => void analytics.refetch()}
        />
      )}
      <div className="grid gap-4 min-[560px]:grid-cols-2 xl:grid-cols-3">
        {metricNames.map((name) => (
          <SalesMetricCard
            key={name}
            name={name}
            metric={first.data.kpis[name]}
            profile={profile}
          />
        ))}
      </div>
      <SalesTrend data={first.data} profile={profile} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Heatmap data={first.data} profile={profile} />
        <PeakHours data={first.data} profile={profile} />
      </div>
      <Breakdowns data={first.data} profile={profile} />
      <RecentOrders
        orders={orders}
        profile={profile}
        hasNext={analytics.hasNextPage}
        pending={analytics.isFetchingNextPage}
        error={analytics.isFetchNextPageError ? analytics.error : null}
        onLoadMore={() => void analytics.fetchNextPage()}
      />
    </SalesFrame>
  );
}

function SalesFrame({
  profile,
  updatedAt,
  children,
}: {
  profile: Profile;
  updatedAt?: string;
  children: ReactNode;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section className="space-y-6" aria-labelledby="sales-title" data-testid="page-sales">
      <PageHeader
        id="sales-title"
        title={translate(locale, "sales.title")}
        description={translate(locale, "sales.description")}
        meta={updatedAt ? formatDate(updatedAt, profile) : undefined}
      />
      {children}
    </section>
  );
}

function SalesMetricCard({
  name,
  metric,
  profile,
}: {
  name: (typeof metricNames)[number];
  metric: SalesData["kpis"][typeof name];
  profile: Profile;
}) {
  const locale = localeFromProfile(profile);
  const percentage = name === "grossMargin";
  const count = name === "orders";
  const value = percentage
    ? formatPercent(metric.value as string | null, profile)
    : count
      ? formatNumber(metric.value as number, profile)
      : metric.value === null
        ? translate(locale, "comparison.notAvailable")
        : formatCurrency(metric.value, profile);
  return (
    <KpiCard
      label={translate(locale, `metrics.${name}` as TranslationKey)}
      value={value}
      comparison={
        <MetricComparison
          change={metric.changePercent}
          profile={profile}
          effect={name === "cogs" ? "inverse" : "direct"}
        />
      }
    />
  );
}

function SalesTrend({ data, profile }: { data: SalesData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const formatBucket = (bucket: string) =>
    data.period === "today"
      ? `${bucket.slice(11, 13)}:00`
      : new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${bucket.slice(0, 10)}T12:00:00.000Z`));
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
      aria-labelledby="sales-trend-title"
    >
      <figcaption
        id="sales-trend-title"
        className="mb-4 text-lg font-semibold text-[var(--color-text)]"
      >
        {translate(locale, "sales.dailyTrend")}
      </figcaption>
      {data.dailySeries.length ? (
        <div className="h-[264px] min-w-0 md:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.dailySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState locale={locale} />
      )}
      <ChartAccessibility
        summary={`${translate(locale, "sales.dailyTrend")}. ${translate(locale, "comparison.versusPrevious")}`}
        caption={translate(locale, "sales.dailyTrend")}
        rows={data.dailySeries}
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

function Heatmap({ data, profile }: { data: SalesData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const cells = new Map(data.heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const maxOrders = Math.max(...data.heatmap.map((cell) => cell.orders), 1);
  const heatmapColors = [
    "var(--color-heatmap-1)",
    "var(--color-heatmap-2)",
    "var(--color-heatmap-3)",
    "var(--color-heatmap-4)",
    "var(--color-heatmap-5)",
  ];
  const weekdays = Array.from({ length: 7 }, (_, weekday) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      weekday: "short",
      timeZone: profile.timeZone ?? "UTC",
    }).format(new Date(Date.UTC(2024, 0, 7 + weekday, 12))),
  );
  return (
    <figure
      className="min-w-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] [contain:paint] sm:p-5"
      aria-labelledby="sales-heatmap-title"
    >
      <figcaption id="sales-heatmap-title" className="space-y-1">
        <span className="block text-lg font-semibold text-[var(--color-text)]">
          {translate(locale, "sales.heatmap")}
        </span>
        <span className="block text-sm text-[var(--color-text-muted)]">
          {translate(locale, "sales.heatmapHint")}
        </span>
      </figcaption>
      <div className="mt-4 overflow-x-auto pb-2">
        <table className="min-w-[46rem] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 bg-[var(--color-surface-raised)] p-1 text-left text-[var(--color-text-muted)]"
              />
              {Array.from({ length: 24 }, (_, hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="min-w-7 p-1 text-center font-medium text-[var(--color-text-muted)]"
                >
                  {hour}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdays.map((weekdayName, weekday) => (
              <tr key={weekday}>
                <th
                  scope="row"
                  className="sticky left-0 bg-[var(--color-surface-raised)] p-1 text-left font-medium text-[var(--color-text-muted)]"
                >
                  {weekdayName}
                </th>
                {Array.from({ length: 24 }, (_, hour) => {
                  const cell = cells.get(`${weekday}:${hour}`);
                  const orders = cell?.orders ?? 0;
                  const colorIndex = orders
                    ? Math.min(4, Math.max(1, Math.ceil((orders / maxOrders) * 4)))
                    : 0;
                  const label = `${translate(locale, "sales.weekdayHour", { weekday: weekdayName, hour })}: ${translate(locale, "sales.ordersAtHour", { count: orders })}, ${formatCurrency(cell?.revenue ?? "0.00", profile)}`;
                  return (
                    <td key={hour} className="p-0.5" aria-label={label} title={label}>
                      <span
                        className="block size-6 rounded-sm"
                        style={{ backgroundColor: heatmapColors[colorIndex] }}
                      >
                        <span className="sr-only">{label}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function PeakHours({ data, profile }: { data: SalesData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const weekday = (value: number) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      weekday: "long",
      timeZone: profile.timeZone ?? "UTC",
    }).format(new Date(Date.UTC(2024, 0, 7 + value, 12)));
  return (
    <article
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]"
      aria-labelledby="peak-hours-title"
    >
      <h2 id="peak-hours-title" className="text-lg font-semibold text-[var(--color-text)]">
        {translate(locale, "sales.peakHours")}
      </h2>
      {data.peakHours.length ? (
        <ol className="mt-5 space-y-3">
          {data.peakHours.map((peak) => (
            <li
              key={`${peak.weekday}:${peak.hour}`}
              className="rounded-lg bg-[var(--color-accent-subtle)] p-3"
            >
              <p className="font-medium text-[var(--color-accent-active)]">
                {translate(locale, "sales.weekdayHour", {
                  weekday: weekday(peak.weekday),
                  hour: peak.hour,
                })}
              </p>
              <p className="mt-1 text-sm text-[var(--color-accent)]">
                {translate(locale, "sales.ordersAtHour", {
                  count: formatNumber(peak.orders, profile),
                })}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 text-[var(--color-text-muted)]">{translate(locale, "states.empty")}</p>
      )}
    </article>
  );
}

function Breakdowns({ data, profile }: { data: SalesData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const lists = [
    ["sales.byLocations", data.locations],
    ["sales.byCategories", data.categories],
    ["sales.byProducts", data.products],
  ] as const;
  return (
    <section className="space-y-4" aria-labelledby="sales-breakdown-title">
      <h2 id="sales-breakdown-title" className="text-xl font-semibold text-[var(--color-text)]">
        {translate(locale, "sales.breakdown")}
      </h2>
      <div className="grid gap-6 xl:grid-cols-3">
        {lists.map(([title, rows]) => (
          <article
            key={title}
            className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)]"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text)]">
              {translate(locale, title)}
            </h3>
            {rows.length ? (
              <div className="mt-4 space-y-3">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg bg-[var(--color-surface-subtle)] p-3 text-sm"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{row.name}</span>
                      <span className="shrink-0">{formatCurrency(row.revenue, profile)}</span>
                    </div>
                    <p className="mt-1 text-[var(--color-text-muted)]">
                      {formatCurrency(row.grossProfit, profile)} ·{" "}
                      {formatNumber(row.orders, profile)} {translate(locale, "metrics.orders")} ·{" "}
                      {formatNumber(row.unitsSold, profile)} {translate(locale, "sales.unitsSold")}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--color-text-muted)]">
                {translate(locale, "states.empty")}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function RecentOrders({
  orders,
  profile,
  hasNext,
  pending,
  error,
  onLoadMore,
}: {
  orders: SalesData["recentOrders"];
  profile: Profile;
  hasNext: boolean;
  pending: boolean;
  error: unknown;
  onLoadMore: () => void;
}) {
  const locale = localeFromProfile(profile);
  return (
    <section
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:p-5"
      aria-labelledby="recent-orders-title"
    >
      <h2 id="recent-orders-title" className="text-xl font-semibold text-[var(--color-text)]">
        {translate(locale, "sales.recentOrders")}
      </h2>
      {!orders.length ? (
        <div className="mt-5">
          <EmptyState locale={locale} />
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3 md:hidden">
            {orders.map((order) => (
              <OrderCard key={order.orderId} order={order} profile={profile} />
            ))}
          </div>
          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-3 pr-3">{translate(locale, "sales.occurredAt")}</th>
                  <th className="pb-3 pr-3">{translate(locale, "filters.location")}</th>
                  <th className="pb-3 pr-3">{translate(locale, "sales.status")}</th>
                  <th className="pb-3 pr-3">{translate(locale, "sales.orderItems")}</th>
                  <th className="pb-3 text-right">{translate(locale, "sales.total")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.orderId}
                    className="border-b border-[var(--color-border-subtle)] align-top"
                  >
                    <td className="py-4 pr-3 whitespace-nowrap">
                      {formatDate(order.occurredAt, profile)}
                    </td>
                    <td className="py-4 pr-3">{order.locationName}</td>
                    <td className="py-4 pr-3">
                      <OrderStatus status={order.status} profile={profile} />
                    </td>
                    <td className="py-4 pr-3">
                      <OrderItems order={order} profile={profile} />
                    </td>
                    <td className="py-4 text-right whitespace-nowrap">
                      {formatCurrency(order.total, profile)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {hasNext && (
        <div className="mt-5">
          <Button type="button" variant="outline" onClick={onLoadMore} disabled={pending}>
            {pending ? translate(locale, "states.loading") : translate(locale, "actions.loadMore")}
          </Button>
          {Boolean(error) && (
            <div className="mt-3">
              <ErrorState locale={locale} error={error} onRetry={onLoadMore} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function OrderCard({
  order,
  profile,
}: {
  order: SalesData["recentOrders"][number];
  profile: Profile;
}) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{order.locationName}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatDate(order.occurredAt, profile)}
          </p>
        </div>
        <OrderStatus status={order.status} profile={profile} />
      </div>
      <div className="mt-4">
        <OrderItems order={order} profile={profile} />
      </div>
      <p className="mt-4 text-right font-semibold">{formatCurrency(order.total, profile)}</p>
    </article>
  );
}

function OrderItems({
  order,
  profile,
}: {
  order: SalesData["recentOrders"][number];
  profile: Profile;
}) {
  return (
    <ul className="space-y-1">
      {order.items.map((item) => (
        <li key={`${order.orderId}:${item.productId}`} className="flex justify-between gap-3">
          <span>
            {item.productName} × {formatNumber(item.quantity, profile)}
          </span>
          <span className="shrink-0">{formatCurrency(item.lineRevenue, profile)}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderStatus({ status, profile }: { status: "completed" | "cancelled"; profile: Profile }) {
  const locale = localeFromProfile(profile);
  return (
    <Badge tone={status === "completed" ? "success" : "neutral"}>
      {translate(locale, `sales.${status}`)}
    </Badge>
  );
}

function SalesSkeleton() {
  return (
    <section className="space-y-6" data-testid="page-sales">
      <div className="space-y-2">
        <Skeleton variant="pageTitleNarrow" />
        <Skeleton variant="pageDescription" />
      </div>
      <div className="grid gap-4 min-[560px]:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} variant="metricCard" />
        ))}
      </div>
      <Skeleton variant="chart" />
    </section>
  );
}
