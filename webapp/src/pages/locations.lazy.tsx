/* eslint-disable react-refresh/only-export-components */
import { useQuery } from "@tanstack/react-query";
import { createLazyRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import type { LocationsData, Profile } from "@brew-dashboard/contracts";
import { ArrowDown, ArrowUp, Award, Circle, Minus, Trophy } from "lucide-react";

import { type AnalyticsFilters, type LocationSorting, locationsQuery } from "@/api/analytics";
import { sessionQueryOptions } from "@/api/session";
import { ErrorState, Skeleton } from "@/components/ui/states";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  localeFromProfile,
  translate,
  type TranslationKey,
} from "@/lib/i18n";

const periods = ["today", "7d", "30d", "6m"] as const;
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

export const Route = createLazyRoute("/app/locations")({ component: LocationsPage });

function LocationsPage() {
  const navigate = useNavigate({ from: "/app/locations" });
  const search = useRouterState({
    select: (state) =>
      state.location.search as {
        period?: string;
        locationId?: string;
        sortBy?: string;
        sortDir?: string;
      },
  });
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const filters: AnalyticsFilters = {
    period: periods.includes(search.period as (typeof periods)[number])
      ? (search.period as AnalyticsFilters["period"])
      : "today",
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };
  const sorting: LocationSorting = {
    sortBy: sortOptions.includes(search.sortBy as LocationsData["sortBy"])
      ? (search.sortBy as LocationsData["sortBy"])
      : "revenue",
    sortDir: search.sortDir === "asc" ? "asc" : "desc",
  };
  const analytics = useQuery({
    ...locationsQuery(profile?.networkId ?? "pending", { ...filters, ...sorting }),
    enabled: Boolean(profile),
  });
  const updateSorting = (next: Partial<LocationSorting>) => {
    void navigate({
      to: "/app/locations",
      search: { period: filters.period, locationId: filters.locationId, ...sorting, ...next },
      replace: true,
    });
  };

  if (!profile || analytics.isPending) return <LocationsSkeleton />;
  if (analytics.isError)
    return (
      <section className="space-y-6" aria-labelledby="locations-title" data-testid="page-locations">
        <div className="space-y-2">
          <h1 id="locations-title" className="text-3xl font-semibold tracking-tight text-stone-950">
            {translate(locale, "locations.title")}
          </h1>
          <p className="text-stone-600">{translate(locale, "locations.description")}</p>
        </div>
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
      <div className="space-y-2">
        <h1 id="locations-title" className="text-3xl font-semibold tracking-tight text-stone-950">
          {translate(locale, "locations.title")}
        </h1>
        <p className="text-stone-600">{translate(locale, "locations.description")}</p>
      </div>

      <section
        className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-end"
        aria-label={translate(locale, "locations.sortBy")}
      >
        <label className="grid min-w-48 gap-1 text-sm font-medium text-stone-700">
          {translate(locale, "locations.sortBy")}
          <select
            className="control"
            value={sorting.sortBy}
            onChange={(event) =>
              updateSorting({ sortBy: event.target.value as LocationsData["sortBy"] })
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
        <label className="grid min-w-44 gap-1 text-sm font-medium text-stone-700">
          {translate(locale, "locations.direction")}
          <select
            className="control"
            value={sorting.sortDir}
            onChange={(event) =>
              updateSorting({ sortDir: event.target.value as LocationSorting["sortDir"] })
            }
          >
            <option value="desc">{translate(locale, "locations.descending")}</option>
            <option value="asc">{translate(locale, "locations.ascending")}</option>
          </select>
        </label>
      </section>

      {!data.locations.length ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-700">
          {translate(locale, "states.empty")}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:hidden">
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
    best: { icon: Trophy, color: "bg-emerald-50 text-emerald-800", label: "locations.best" },
    weak: { icon: Award, color: "bg-amber-50 text-amber-900", label: "locations.weak" },
    standard: { icon: Circle, color: "bg-stone-100 text-stone-700", label: "locations.standard" },
  } as const;
  const { icon: Icon, color, label } = details[performance];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {translate(locale, label)}
    </span>
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
    <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-950">{location.name}</h2>
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
    <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-stone-50 text-stone-600">
          <tr>
            <th className="px-4 py-3 font-semibold">
              {translate(locale, "locations.locationName")}
            </th>
            {metrics.map((metric) => (
              <th key={metric} className="px-3 py-3 font-semibold">
                {translate(locale, `metrics.${metric}` as TranslationKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {locations.map((location) => (
            <tr key={location.locationId}>
              <th scope="row" className="px-4 py-4 align-top">
                <span className="block font-semibold text-stone-950">{location.name}</span>
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
      <dt className="text-xs font-medium text-stone-600">
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
  if (name === "activeAlerts") return <span className="font-semibold text-stone-950">{value}</span>;
  const change = metric.changePercent as string | number | null;
  const numericChange = change === null ? null : Number(change);
  const state =
    numericChange === null ? "na" : numericChange > 0 ? "up" : numericChange < 0 ? "down" : "flat";
  const Icon = state === "up" ? ArrowUp : state === "down" ? ArrowDown : Minus;
  const color =
    state === "up" ? "text-emerald-700" : state === "down" ? "text-red-700" : "text-stone-600";
  return (
    <span>
      <span className="block font-semibold text-stone-950">{value}</span>
      <span className={`mt-1 flex items-center gap-1 text-xs ${color}`}>
        <Icon className="size-3.5" aria-hidden="true" />
        {numericChange === null
          ? translate(locale, "comparison.notAvailable")
          : formatPercent(Math.abs(numericChange), profile)}
      </span>
    </span>
  );
}

function LocationsSkeleton() {
  return (
    <section className="space-y-6" aria-busy="true" aria-label="Loading locations">
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <Skeleton className="h-24" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-64" />
        ))}
      </div>
    </section>
  );
}
