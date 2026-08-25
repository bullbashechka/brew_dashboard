/* eslint-disable react-refresh/only-export-components */
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyRoute, useRouterState } from "@tanstack/react-router";
import type { OverviewData, Profile } from "@brew-dashboard/contracts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Minus,
  PackageCheck,
  PackageX,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
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
import { toast } from "sonner";

import { type AnalyticsFilters, overviewQuery } from "@/api/analytics";
import { resetDemoData } from "@/api/demo";
import { sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { Button } from "@/components/ui/button";
import { ErrorState, PendingButton, Skeleton } from "@/components/ui/states";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
  type TranslationKey,
} from "@/lib/i18n";

const periods = ["today", "7d", "30d", "6m"] as const;
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

export const Route = createLazyRoute("/app/overview")({ component: OverviewPage });

function OverviewPage() {
  const queryClient = useQueryClient();
  const search = useRouterState({
    select: (state) => state.location.search as { period?: string; locationId?: string },
  });
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const filters: AnalyticsFilters = {
    period: periods.includes(search.period as (typeof periods)[number])
      ? (search.period as AnalyticsFilters["period"])
      : "today",
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };
  const analytics = useQuery({
    ...overviewQuery(profile?.networkId ?? "pending", filters),
    enabled: Boolean(profile),
  });
  const [resetOpen, setResetOpen] = useState(false);
  const resetKey = useRef<string | null>(null);
  const reset = useMutation({
    mutationFn: () => {
      resetKey.current ??= crypto.randomUUID();
      return resetDemoData(resetKey.current);
    },
    onSuccess: async (response) => {
      queryClient.setQueryData<Profile | null>(sessionQueryKey, response.data.profile);
      await queryClient.invalidateQueries({
        queryKey: ["tenant", response.data.profile.networkId],
      });
      resetKey.current = null;
      setResetOpen(false);
      toast.success(translate(locale, "reset.complete"));
    },
  });

  if (!profile || analytics.isPending) return <OverviewSkeleton />;
  if (analytics.isError)
    return (
      <OverviewError
        locale={locale}
        error={analytics.error}
        onRetry={() => void analytics.refetch()}
      />
    );

  return (
    <section className="space-y-6" aria-labelledby="overview-title" data-testid="page-overview">
      <div className="space-y-2">
        <h1 id="overview-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "overview.title")}
        </h1>
        <p className="text-stone-600">{translate(locale, "overview.description")}</p>
        <p className="text-sm text-stone-500">
          {translate(locale, "overview.updatedAt", {
            value: formatDate(analytics.data.meta.asOf, profile),
          })}
        </p>
      </div>

      {profile.demoDataStale && (
        <section
          className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="stale-demo-title"
        >
          <div className="flex gap-3">
            <RefreshCw className="mt-0.5 size-5 shrink-0 text-amber-900" aria-hidden="true" />
            <div>
              <h2 id="stale-demo-title" className="font-semibold text-amber-950">
                {translate(locale, "reset.staleTitle")}
              </h2>
              <p className="mt-1 text-sm text-amber-950/80">
                {translate(locale, "reset.staleDescription")}
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => setResetOpen(true)}>
            {translate(locale, "reset.open")}
          </Button>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metricNames.map((metric) => (
          <OverviewMetricCard
            key={metric}
            name={metric}
            metric={analytics.data.data.kpis[metric]}
            profile={profile}
          />
        ))}
      </div>

      <TrendChart data={analytics.data.data} profile={profile} />

      <div className="grid gap-6 xl:grid-cols-2">
        <GoalCard data={analytics.data.data} profile={profile} />
        <LocationComparison data={analytics.data.data} profile={profile} />
        <ProductList
          title="overview.topProducts"
          products={analytics.data.data.topProducts}
          profile={profile}
          icon={<TrendingUp className="size-5 text-emerald-700" aria-hidden="true" />}
        />
        <ProductList
          title="overview.bottomProducts"
          products={analytics.data.data.bottomProducts}
          profile={profile}
          icon={<TrendingDown className="size-5 text-amber-800" aria-hidden="true" />}
        />
        <StockSummary data={analytics.data.data} profile={profile} />
        <AlertsList data={analytics.data.data} profile={profile} />
      </div>

      <ResetDemoDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!reset.isPending) setResetOpen(open);
        }}
        locale={locale}
        pending={reset.isPending}
        error={reset.error}
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
    <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-stone-600">
        {translate(locale, `metrics.${name}` as TranslationKey)}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">{value}</p>
      {name !== "activeAlerts" && (
        <Comparison change={metric.changePercent as string | number | null} profile={profile} />
      )}
    </article>
  );
}

function Comparison({ change, profile }: { change: string | number | null; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const numericChange = change === null ? null : Number(change);
  const magnitude = numericChange === null ? null : formatPercent(Math.abs(numericChange), profile);
  const state =
    numericChange === null ? "na" : numericChange > 0 ? "up" : numericChange < 0 ? "down" : "flat";
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
  return (
    <p className={`mt-3 flex items-center gap-1.5 text-sm ${color}`} aria-label={label}>
      <Icon className="size-4" aria-hidden="true" />
      <span>{state === "na" ? label : magnitude}</span>
      <span className="text-stone-500">{translate(locale, "comparison.versusPrevious")}</span>
    </p>
  );
}

function TrendChart({ data, profile }: { data: OverviewData; profile: Profile }) {
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
        <span className="text-sm text-stone-500">
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

function GoalCard({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const goal = data.goal;
  const completion = goal?.completionPercent ?? null;
  const visibleCompletion =
    completion === null ? 0 : Math.min(100, Math.max(0, Number(completion)));
  return (
    <article
      className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
      aria-labelledby="goal-title"
    >
      <div className="flex items-center gap-2">
        <Target className="size-5 text-amber-900" aria-hidden="true" />
        <h2 id="goal-title" className="text-lg font-semibold text-stone-950">
          {translate(locale, "overview.monthlyGoal")}
        </h2>
      </div>
      <p className="mt-1 text-sm text-stone-500">{translate(locale, "overview.networkWide")}</p>
      {!goal ? (
        <p className="mt-8 text-stone-600">{translate(locale, "overview.goalNotSet")}</p>
      ) : (
        <>
          <p className="mt-6 text-2xl font-semibold text-stone-950">
            {formatPercent(completion, profile)}
          </p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-amber-800"
              style={{ width: `${visibleCompletion}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-stone-600">
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
      className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
      aria-labelledby="location-comparison-title"
    >
      <h2 id="location-comparison-title" className="text-lg font-semibold text-stone-950">
        {translate(locale, "overview.locationComparison")}
      </h2>
      {data.locations.length ? (
        <div className="mt-5 space-y-4">
          {data.locations.map((location) => (
            <div key={location.locationId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-stone-800">{location.name}</span>
                <span className="shrink-0 text-stone-600">
                  {formatCurrency(location.revenue, profile)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-amber-800"
                  style={{
                    width: `${maxRevenue ? (Number(location.revenue) / maxRevenue) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {formatNumber(location.orders, profile)} · {translate(locale, "metrics.orders")} ·{" "}
                {formatNumber(location.activeAlerts, profile)} ·{" "}
                {translate(locale, "metrics.activeAlerts")}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-stone-600">{translate(locale, "states.empty")}</p>
      )}
    </article>
  );
}

function ProductList({
  title,
  products,
  profile,
  icon,
}: {
  title: "overview.topProducts" | "overview.bottomProducts";
  products: OverviewData["topProducts"];
  profile: Profile;
  icon: ReactNode;
}) {
  const locale = localeFromProfile(profile);
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold text-stone-950">{translate(locale, title)}</h2>
      </div>
      {products.length ? (
        <ol className="mt-4 space-y-3">
          {products.map((product) => (
            <li key={product.productId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-stone-800">{product.name}</span>
                <span className="block truncate text-stone-500">{product.categoryName}</span>
              </span>
              <span className="shrink-0 text-stone-700">
                {formatCurrency(product.revenue, profile)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 text-stone-600">{translate(locale, "states.empty")}</p>
      )}
    </article>
  );
}

function StockSummary({ data, profile }: { data: OverviewData; profile: Profile }) {
  const locale = localeFromProfile(profile);
  const items = [
    { key: "inStock" as const, icon: PackageCheck, color: "text-emerald-700" },
    { key: "lowStock" as const, icon: AlertTriangle, color: "text-amber-800" },
    { key: "outOfStock" as const, icon: PackageX, color: "text-red-700" },
  ];
  return (
    <article
      className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
      aria-labelledby="stock-summary-title"
    >
      <h2 id="stock-summary-title" className="text-lg font-semibold text-stone-950">
        {translate(locale, "overview.stockSummary")}
      </h2>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        {items.map(({ key, icon: Icon, color }) => (
          <div key={key} className="rounded-lg bg-stone-50 p-3">
            <dt className={`flex items-center gap-1.5 text-sm font-medium ${color}`}>
              <Icon className="size-4" aria-hidden="true" />
              {translate(locale, `overview.${key}` as TranslationKey)}
            </dt>
            <dd className="mt-2 text-xl font-semibold text-stone-950">
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
      className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
      aria-labelledby="recent-alerts-title"
    >
      <h2 id="recent-alerts-title" className="text-lg font-semibold text-stone-950">
        {translate(locale, "overview.recentAlerts")}
      </h2>
      {data.alerts.length ? (
        <ul className="mt-4 space-y-3">
          {data.alerts.map((alert) => (
            <li key={alert.id} className="flex gap-3 rounded-lg bg-stone-50 p-3 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-800" aria-hidden="true" />
              <span>
                <span className="block font-medium text-stone-800">
                  {translate(locale, labels[alert.type])}
                </span>
                <span className="block text-stone-600">
                  {alert.locationName}
                  {alert.entityName ? ` · ${alert.entityName}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-stone-600">{translate(locale, "alerts.none")}</p>
      )}
    </article>
  );
}

function ResetDemoDialog({
  open,
  onOpenChange,
  locale,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: ReturnType<typeof localeFromProfile>;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-white p-6 shadow-xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-stone-950">
                {translate(locale, "reset.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-stone-600">
                {translate(locale, "reset.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild disabled={pending}>
              <button
                type="button"
                className="icon-button -mr-2 -mt-2"
                aria-label={translate(locale, "actions.close")}
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <ul className="mt-5 space-y-3 text-sm text-stone-700">
            <li className="rounded-lg bg-amber-50 p-3">{translate(locale, "reset.resetItems")}</li>
            <li className="rounded-lg bg-emerald-50 p-3">{translate(locale, "reset.keepItems")}</li>
          </ul>
          {Boolean(error) && (
            <div className="mt-4">
              <ErrorState locale={locale} error={error} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild disabled={pending}>
              <Button type="button" variant="outline">
                {translate(locale, "actions.cancel")}
              </Button>
            </Dialog.Close>
            <PendingButton
              type="button"
              pending={pending}
              pendingLabel={translate(locale, "reset.pending")}
              onClick={onConfirm}
            >
              {translate(locale, "reset.confirm")}
            </PendingButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OverviewSkeleton() {
  return (
    <section className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metricNames.map((metric) => (
          <Skeleton key={metric} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-80" />
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
      <div className="space-y-2">
        <h1 id="overview-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "overview.title")}
        </h1>
        <p className="text-stone-600">{translate(locale, "overview.description")}</p>
      </div>
      <ErrorState locale={locale} error={error} onRetry={onRetry} />
    </section>
  );
}
