import { useQuery } from "@tanstack/react-query";
import type { LocationsData, Profile } from "@brew-dashboard/contracts";
import { Award, Circle, Trophy } from "lucide-react";

import { type AnalyticsFilters, type LocationSorting, locationsQuery } from "@/api/analytics";
import { MetricComparison } from "@/components/metric-comparison";
import { sessionQueryOptions } from "@/api/session";
import { CachedSnapshotWarning, ErrorState, Skeleton } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/layout";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
  type TranslationKey,
} from "@/lib/i18n";

const sortOptions: Array<LocationsData["sortBy"]> = [
  "revenue",
  "grossProfit",
  "orders",
  "averageCheck",
  "grossMargin",
  "activeAlerts",
  "name",
];

const metrics = [
  "revenue",
  "grossProfit",
  "orders",
  "averageCheck",
  "grossMargin",
  "activeAlerts",
] as const;

export function LocationsPage({
  filters,
  sorting,
  onSortingChange,
}: {
  filters: AnalyticsFilters;
  sorting: LocationSorting;
  onSortingChange: (next: Partial<LocationSorting>) => void;
}) {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const analytics = useQuery({
    ...locationsQuery(profile?.networkId ?? "pending", { ...filters, ...sorting }),
    enabled: Boolean(profile),
  });

  if (!profile || analytics.isPending) return <LocationsSkeleton locale={locale} />;
  if (analytics.isLoadingError || !analytics.data)
    return (
      <section className="space-y-6" aria-labelledby="locations-title" data-testid="page-locations">
        <PageHeader
          id="locations-title"
          title={translate(locale, "locations.title")}
          description={translate(locale, "locations.description")}
        />
        <ErrorState
          locale={locale}
          error={analytics.error}
          onRetry={() => void analytics.refetch()}
        />
      </section>
    );

  const data = analytics.data.data;
  return (
    <section className="space-y-6" aria-labelledby="locations-title" data-testid="page-locations">
      <PageHeader
        id="locations-title"
        title={translate(locale, "locations.title")}
        description={translate(locale, "locations.description")}
        meta={formatDate(analytics.data.meta.asOf, profile)}
      />

      {analytics.isRefetchError && (
        <CachedSnapshotWarning
          profile={profile}
          error={analytics.error}
          asOf={analytics.data.meta.asOf}
          onRetry={() => void analytics.refetch()}
        />
      )}

      <section
        className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-end"
        aria-label={translate(locale, "locations.sortBy")}
      >
        <label className="grid min-w-48 gap-1 text-sm font-medium text-[var(--color-text-secondary)]">
          {translate(locale, "locations.sortBy")}
          <select
            className="control"
            value={sorting.sortBy}
            onChange={(event) =>
              onSortingChange({ sortBy: event.target.value as LocationsData["sortBy"] })
            }
          >
            {sortOptions.map((option) => (
              <option key={option} value={option}>
                {translate(
                  locale,
                  option === "name"
                    ? "locations.locationName"
                    : (`metrics.${option}` as TranslationKey),
                )}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-44 gap-1 text-sm font-medium text-[var(--color-text-secondary)]">
          {translate(locale, "locations.direction")}
          <select
            className="control"
            value={sorting.sortDir}
            onChange={(event) =>
              onSortingChange({ sortDir: event.target.value as LocationSorting["sortDir"] })
            }
          >
            <option value="desc">{translate(locale, "locations.descending")}</option>
            <option value="asc">{translate(locale, "locations.ascending")}</option>
          </select>
        </label>
      </section>

      {!data.locations.length ? (
        <p className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] p-8 text-center text-[var(--color-text-secondary)]">
          {translate(locale, "states.empty")}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 md:hidden">
            {data.locations.map((location) => (
              <LocationCard key={location.locationId} location={location} profile={profile} />
            ))}
          </div>
          <LocationsTable locations={data.locations} profile={profile} />
        </>
      )}
    </section>
  );
}

export function LocationsPerformanceBadge({
  performance,
  profile,
}: {
  performance: LocationsData["locations"][number]["performance"];
  profile: Profile;
}) {
  const locale = localeFromProfile(profile);
  const details = {
    best: { icon: Trophy, tone: "success", label: "locations.best" },
    weak: { icon: Award, tone: "warning", label: "locations.weak" },
    standard: { icon: Circle, tone: "neutral", label: "locations.standard" },
  } as const;
  const { icon: Icon, tone, label } = details[performance];
  return (
    <Badge tone={tone}>
      <span className="inline-flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden="true" />
        {translate(locale, label)}
      </span>
    </Badge>
  );
}

function LocationCard({
  location,
  profile,
}: {
  location: LocationsData["locations"][number];
  profile: Profile;
}) {
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{location.name}</h2>
        <LocationsPerformanceBadge performance={location.performance} profile={profile} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <MetricCell key={metric} name={metric} metric={location.kpis[metric]} profile={profile} />
        ))}
      </dl>
    </article>
  );
}

function LocationsTable({
  locations,
  profile,
}: {
  locations: LocationsData["locations"];
  profile: Profile;
}) {
  const locale = localeFromProfile(profile);
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-[var(--shadow-card)] md:block">
      <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
        <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]">
          <tr>
            <th className="sticky left-0 bg-[var(--color-surface-subtle)] px-4 py-3 font-semibold">
              {translate(locale, "locations.locationName")}
            </th>
            {metrics.map((metric) => (
              <th key={metric} className="px-3 py-3 font-semibold">
                {translate(locale, `metrics.${metric}` as TranslationKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {locations.map((location) => (
            <tr key={location.locationId}>
              <th
                scope="row"
                className="sticky left-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-4 align-top"
              >
                <span className="block font-semibold text-[var(--color-text)]">
                  {location.name}
                </span>
                <span className="mt-2 block">
                  <LocationsPerformanceBadge performance={location.performance} profile={profile} />
                </span>
              </th>
              {metrics.map((metric) => (
                <td key={metric} className="px-3 py-4 align-top">
                  <MetricValue name={metric} metric={location.kpis[metric]} profile={profile} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCell({
  name,
  metric,
  profile,
}: {
  name: (typeof metrics)[number];
  metric: LocationsData["locations"][number]["kpis"][(typeof metrics)[number]];
  profile: Profile;
}) {
  const locale = localeFromProfile(profile);
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">
        {translate(locale, `metrics.${name}` as TranslationKey)}
      </dt>
      <dd className="mt-1">
        <MetricValue name={name} metric={metric} profile={profile} />
      </dd>
    </div>
  );
}

function MetricValue({
  name,
  metric,
  profile,
}: {
  name: (typeof metrics)[number];
  metric: LocationsData["locations"][number]["kpis"][(typeof metrics)[number]];
  profile: Profile;
}) {
  const locale = localeFromProfile(profile);
  const metricValue = metric.value as string | number | null;
  const value =
    name === "grossMargin"
      ? formatPercent(metricValue, profile)
      : name === "orders" || name === "activeAlerts"
        ? formatNumber(metricValue ?? 0, profile)
        : metricValue === null
          ? translate(locale, "comparison.notAvailable")
          : formatCurrency(metricValue, profile);
  if (name === "activeAlerts")
    return <span className="font-semibold text-[var(--color-text)]">{value}</span>;
  return (
    <span>
      <span className="block font-semibold text-[var(--color-text)]">{value}</span>
      <MetricComparison
        change={metric.changePercent as string | number | null}
        profile={profile}
        variant="compact"
      />
    </span>
  );
}

function LocationsSkeleton({ locale }: { locale: ReturnType<typeof localeFromProfile> }) {
  return (
    <section
      className="space-y-6"
      aria-busy="true"
      aria-label={`${translate(locale, "states.loading")} ${translate(locale, "navigation.locations")}`}
    >
      <div className="space-y-3">
        <Skeleton variant="pageTitle" />
        <Skeleton variant="pageDescription" />
      </div>
      <Skeleton variant="filterBar" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} variant="locationCard" />
        ))}
      </div>
    </section>
  );
}
