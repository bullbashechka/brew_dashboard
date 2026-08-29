import { useQuery } from "@tanstack/react-query";
import type { OverviewData, Profile } from "@brew-dashboard/contracts";
import {
  AlertTriangle,
  CircleAlert,
  PackageCheck,
  PackageX,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { type AnalyticsFilters, overviewQuery } from "@/api/analytics";
import { MetricComparison } from "@/components/metric-comparison";
import { sessionQueryOptions } from "@/api/session";
import { Button } from "@/components/ui/button";
import { CachedSnapshotWarning, ErrorState, Skeleton } from "@/components/ui/states";
import { ResetDemoDialog } from "@/components/reset-demo-dialog";
import { PageHeader } from "@/components/ui/layout";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
  type TranslationKey,
} from "@/lib/i18n";
import { useResetDemoData } from "@/lib/reset-demo";

type MetricName =
  "revenue" | "grossProfit" | "orders" | "averageCheck" | "grossMargin" | "activeAlerts";
const metricNames: MetricName[] = [
  "revenue",
  "grossProfit",
  "orders",
  "averageCheck",
  "grossMargin",
  "activeAlerts",
];

const TrendChart = lazy(() =>
  import("@/components/overview-trend-chart").then((module) => ({
    default: module.OverviewTrendChart,
  })),
);

export function OverviewPage({ filters }: { filters: AnalyticsFilters }) {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const analytics = useQuery({
    ...overviewQuery(profile?.networkId ?? "pending", filters),
    enabled: Boolean(profile),
  });
  const [resetOpen, setResetOpen] = useState(false);
  const reset = useResetDemoData(locale, () => setResetOpen(false));

  if (!profile || analytics.isPending) return <OverviewSkeleton locale={locale} />;
  if (analytics.isLoadingError || !analytics.data)
    return (
      <OverviewError
        locale={locale}
        error={analytics.error}
        onRetry={() => void analytics.refetch()}
      />
    );

  return (
    <section className="space-y-6" aria-labelledby="overview-title" data-testid="page-overview">
      <PageHeader
        id="overview-title"
        title={translate(locale, "overview.title")}
        description={translate(locale, "overview.description")}
        meta={translate(locale, "overview.updatedAt", {
          value: formatDate(analytics.data.meta.asOf, profile),
        })}
      />

      {profile.demoDataStale && (
        <section
          className="flex flex-col gap-4 rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] p-4 text-[var(--color-warning)] sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="stale-demo-title"
        >
          <div className="flex gap-3">
            <RefreshCw className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="stale-demo-title" className="font-semibold">
                {translate(locale, "reset.staleTitle")}
              </h2>
              <p className="mt-1 text-sm">{translate(locale, "reset.staleDescription")}</p>
            </div>
          </div>
          <Button
            type="button"
            disabled={analytics.isRefetchError}
            onClick={() => setResetOpen(true)}
          >
            {translate(locale, "reset.open")}
          </Button>
        </section>
      )}

      {analytics.isRefetchError && (
        <CachedSnapshotWarning
          profile={profile}
          error={analytics.error}
          asOf={analytics.data.meta.asOf}
          onRetry={() => void analytics.refetch()}
        />
      )}

      <div className="grid gap-4 min-[560px]:grid-cols-2 xl:grid-cols-3">
        {metricNames.map((metric) => (
          <OverviewMetricCard
            key={metric}
            name={metric}
            metric={analytics.data.data.kpis[metric]}
            profile={profile}
          />
        ))}
      </div>

      <Suspense fallback={<TrendChartFallback locale={locale} />}>
        <TrendChart data={analytics.data.data} profile={profile} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-2">
        <GoalCard data={analytics.data.data} profile={profile} />
        <LocationComparison data={analytics.data.data} profile={profile} />
        <AlertsList data={analytics.data.data} profile={profile} />
        <StockSummary data={analytics.data.data} profile={profile} />
        <ProductList
          title="overview.topProducts"
          products={analytics.data.data.topProducts}
          profile={profile}
          trend="up"
        />
        <ProductList
          title="overview.bottomProducts"
          products={analytics.data.data.bottomProducts}
          profile={profile}
          trend="down"
        />
      </div>

      <ResetDemoDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!reset.isPending) setResetOpen(open);
        }}
        locale={locale}
        pending={reset.isPending}
        error={reset.error}
        disabled={analytics.isRefetchError}
        onConfirm={() => reset.mutate()}
      />
    </section>
  );
}

export function OverviewMetricCard({
  name,
  metric,
  profile,
}: {
  name: MetricName;
  metric: OverviewData["kpis"][MetricName];
  profile: Profile;
}) {
  const locale = localeFromProfile(profile);
  const isPercentage = name === "grossMargin";
  const isCount = name === "orders" || name === "activeAlerts";
  const value = isPercentage
    ? formatPercent(metric.value, profile)
    : isCount
      ? formatNumber(metric.value as number, profile)
      : metric.value === null
        ? translate(locale, "comparison.notAvailable")
        : formatCurrency(metric.value, profile);
  return (
    <KpiCard
      label={translate(locale, `metrics.${name}` as TranslationKey)}
      value={value}
      comparison={
        name !== "activeAlerts" ? (
          <MetricComparison
            change={metric.changePercent as string | number | null}
            profile={profile}
          />
        ) : undefined
      }
    />
  );
}

function TrendChartFallback({ locale }: { locale: ReturnType<typeof localeFromProfile> }) {
  return (
    <figure
      className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:p-5"
      aria-labelledby="trend-title"
      aria-busy="true"
    >
      <figcaption id="trend-title" className="text-lg font-semibold text-[var(--color-text)]">
        {translate(locale, "overview.trend")}
      </figcaption>
      <div className="mt-4">
        <Skeleton variant="chart" />
      </div>
    </figure>
  );
}

function GoalCard({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const goal = data.goal;
  const completion = goal?.completionPercent ?? null;
  const visibleCompletion =
    completion === null ? 0 : Math.min(100, Math.max(0, Number(completion)));
  return (
    <article
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]"
      aria-labelledby="goal-title"
    >
      <div className="flex items-center gap-2">
        <Target className="size-5 text-[var(--color-accent)]" aria-hidden="true" />
        <h2 id="goal-title" className="text-lg font-semibold text-[var(--color-text)]">
          {translate(locale, "overview.monthlyGoal")}
        </h2>
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {translate(locale, "overview.networkWide")}
      </p>
      {!goal ? (
        <p className="mt-8 text-[var(--color-text-muted)]">
          {translate(locale, "overview.goalNotSet")}
        </p>
      ) : (
        <>
          <p className="mt-6 text-2xl font-semibold text-[var(--color-text)]">
            {formatPercent(completion, profile)}
          </p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)]"
              style={{ width: `${visibleCompletion}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            {formatCurrency(goal.revenue, profile)} / {formatCurrency(goal.target, profile)}
          </p>
        </>
      )}
    </article>
  );
}

function LocationComparison({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const maxRevenue = Math.max(...data.locations.map((location) => Number(location.revenue)), 0);
  return (
    <article
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]"
      aria-labelledby="location-comparison-title"
    >
      <h2 id="location-comparison-title" className="text-lg font-semibold text-[var(--color-text)]">
        {translate(locale, "overview.locationComparison")}
      </h2>
      {data.locations.length ? (
        <div className="mt-5 space-y-4">
          {data.locations.map((location) => (
            <div key={location.locationId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-[var(--color-text)]">
                  {location.name}
                </span>
                <span className="shrink-0 text-[var(--color-text-muted)]">
                  {formatCurrency(location.revenue, profile)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{
                    width: `${maxRevenue ? (Number(location.revenue) / maxRevenue) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {formatNumber(location.orders, profile)} · {translate(locale, "metrics.orders")} ·{" "}
                {formatNumber(location.activeAlerts, profile)} ·{" "}
                {translate(locale, "metrics.activeAlerts")}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-[var(--color-text-muted)]">{translate(locale, "states.empty")}</p>
      )}
    </article>
  );
}

function ProductList({
  title,
  products,
  profile,
  trend,
}: {
  title: "overview.topProducts" | "overview.bottomProducts";
  products: OverviewData["topProducts"];
  profile: Profile;
  trend: "up" | "down";
}) {
  const locale = localeFromProfile(profile);
  const Icon = trend === "up" ? TrendingUp : TrendingDown;
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <Icon
          className={
            trend === "up"
              ? "size-5 text-[var(--color-success)]"
              : "size-5 text-[var(--color-warning)]"
          }
          aria-hidden="true"
        />
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          {translate(locale, title)}
        </h2>
      </div>
      {products.length ? (
        <ol className="mt-4 space-y-3">
          {products.map((product) => (
            <li key={product.productId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-[var(--color-text)]">
                  {product.name}
                </span>
                <span className="block truncate text-[var(--color-text-muted)]">
                  {product.categoryName}
                </span>
              </span>
              <span className="shrink-0 text-[var(--color-text-secondary)]">
                {formatCurrency(product.revenue, profile)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 text-[var(--color-text-muted)]">{translate(locale, "states.empty")}</p>
      )}
    </article>
  );
}

function StockSummary({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const items = [
    { key: "inStock" as const, icon: PackageCheck, color: "text-[var(--color-success)]" },
    { key: "lowStock" as const, icon: AlertTriangle, color: "text-[var(--color-warning)]" },
    { key: "outOfStock" as const, icon: PackageX, color: "text-[var(--color-danger)]" },
  ];
  return (
    <article
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]"
      aria-labelledby="stock-summary-title"
    >
      <h2 id="stock-summary-title" className="text-lg font-semibold text-[var(--color-text)]">
        {translate(locale, "overview.stockSummary")}
      </h2>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        {items.map(({ key, icon: Icon, color }) => (
          <div key={key} className="rounded-lg bg-[var(--color-surface-subtle)] p-3">
            <dt className={`flex items-center gap-1.5 text-sm font-medium ${color}`}>
              <Icon className="size-4" aria-hidden="true" />
              {translate(locale, `overview.${key}` as TranslationKey)}
            </dt>
            <dd className="mt-2 text-xl font-semibold text-[var(--color-text)]">
              {formatNumber(data.stockSummary[key], profile)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function AlertsList({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const labels = {
    LOW_STOCK: "alerts.lowStock",
    OUT_OF_STOCK: "alerts.outOfStock",
    SALES_DROP: "alerts.salesDrop",
  } as const;
  return (
    <article
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]"
      aria-labelledby="recent-alerts-title"
    >
      <h2 id="recent-alerts-title" className="text-lg font-semibold text-[var(--color-text)]">
        {translate(locale, "overview.recentAlerts")}
      </h2>
      {data.alerts.length ? (
        <ul className="mt-4 space-y-3">
          {data.alerts.map((alert) => (
            <li
              key={alert.id}
              className="flex gap-3 rounded-lg bg-[var(--color-surface-subtle)] p-3 text-sm"
            >
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]"
                aria-hidden="true"
              />
              <span>
                <span className="block font-medium text-[var(--color-text)]">
                  {translate(locale, labels[alert.type])}
                </span>
                <span className="block text-[var(--color-text-muted)]">
                  {alert.locationName}
                  {alert.entityName ? ` · ${alert.entityName}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-[var(--color-text-muted)]">{translate(locale, "alerts.none")}</p>
      )}
    </article>
  );
}

function OverviewSkeleton({ locale }: { locale: ReturnType<typeof localeFromProfile> }) {
  return (
    <section
      className="space-y-6"
      aria-busy="true"
      aria-label={`${translate(locale, "states.loading")} ${translate(locale, "navigation.overview")}`}
    >
      <div className="space-y-3">
        <Skeleton variant="pageTitle" />
        <Skeleton variant="pageDescription" />
      </div>
      <div className="grid gap-4 min-[560px]:grid-cols-2 xl:grid-cols-3">
        {metricNames.map((metric) => (
          <Skeleton key={metric} variant="metricCard" />
        ))}
      </div>
      <Skeleton variant="chart" />
    </section>
  );
}

function OverviewError({
  locale,
  error,
  onRetry,
}: {
  locale: ReturnType<typeof localeFromProfile>;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <section className="space-y-6" aria-labelledby="overview-title" data-testid="page-overview">
      <PageHeader
        id="overview-title"
        title={translate(locale, "overview.title")}
        description={translate(locale, "overview.description")}
      />
      <ErrorState locale={locale} error={error} onRetry={onRetry} />
    </section>
  );
}
