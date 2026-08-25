import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Bell, Coffee, LogOut, Menu, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { locationOptionsQuery, overviewQuery, type AnalyticsFilters } from "@/api/analytics";
import type { z } from "zod";
import { overviewResponseSchema, type Profile, type TourState } from "@brew-dashboard/contracts";
import { logout, sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { saveTourState } from "@/api/tour";
import { GuidedTour } from "@/components/guided-tour";
import { ErrorState, LoadingState, PendingButton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { localeFromProfile, translate } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";

const sections = ["overview", "locations", "sales", "products", "inventory", "settings"] as const;
type Section = (typeof sections)[number];
const analyticsSections = new Set<Section>([
  "overview",
  "locations",
  "sales",
  "products",
  "inventory",
]);

const periods = ["today", "7d", "30d", "6m"] as const;
const periodKey = {
  today: "today",
  "7d": "sevenDays",
  "30d": "thirtyDays",
  "6m": "sixMonths",
} as const;

const sectionFromPath = (pathname: string): Section => {
  const match = sections.find((section) => pathname.endsWith(`/${section}`));
  return match ?? "overview";
};

export function AppShell() {
  const navigate = useNavigate({ from: "/app" });
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({
    select: (state) => state.location.search as Record<string, unknown>,
  });
  const section = sectionFromPath(pathname);
  const isAnalytics = analyticsSections.has(section);
  const filters = useMemo<AnalyticsFilters>(
    () => ({
      period: periods.includes(search.period as (typeof periods)[number])
        ? (search.period as AnalyticsFilters["period"])
        : "today",
      ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
    }),
    [search.locationId, search.period],
  );
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const locations = useQuery({
    ...locationOptionsQuery(profile?.networkId ?? "pending"),
    enabled: Boolean(profile),
  });
  const alerts = useQuery({
    ...overviewQuery(profile?.networkId ?? "pending", filters),
    enabled: Boolean(profile),
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tourOpen = profile?.tourState === "pending" && section === "overview";

  useEffect(() => {
    if (!filters.locationId) return;
    const missingFromOptions =
      Boolean(locations.data) &&
      !locations.data!.some((location) => location.locationId === filters.locationId);
    const apiFellBack = alerts.data?.meta.warnings.some(
      (warning) => warning.code === "INVALID_LOCATION_FALLBACK",
    );
    if (!missingFromOptions && !apiFellBack) return;
    void navigate({
      to: pathname,
      search: { period: filters.period, locationId: undefined },
      replace: true,
    });
    toast.message(translate(locale, "filters.allLocations"));
  }, [
    alerts.data?.meta.warnings,
    filters.locationId,
    filters.period,
    locale,
    locations.data,
    navigate,
    pathname,
  ]);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({ to: "/login", search: { redirect: undefined }, replace: true });
    },
  });

  if (!profile) return <LoadingState locale={locale} />;

  const persistTourState = async (state: TourState) => {
    const response = await saveTourState(state);
    queryClient.setQueryData<Profile | null>(sessionQueryKey, (current) =>
      current ? { ...current, tourState: response.data.state } : current,
    );
  };

  const updateFilters = (next: {
    period?: AnalyticsFilters["period"];
    locationId?: string | null;
  }) => {
    const locationsSearch =
      section === "locations"
        ? {
            sortBy:
              search.sortBy === "revenue" ||
              search.sortBy === "grossProfit" ||
              search.sortBy === "orders" ||
              search.sortBy === "averageCheck" ||
              search.sortBy === "grossMargin" ||
              search.sortBy === "activeAlerts" ||
              search.sortBy === "name"
                ? search.sortBy
                : "revenue",
            sortDir:
              search.sortDir === "asc" || search.sortDir === "desc" ? search.sortDir : "desc",
          }
        : {};
    void navigate({
      to: pathname,
      search: {
        period: next.period ?? filters.period,
        locationId: next.locationId === null ? undefined : (next.locationId ?? filters.locationId),
        ...locationsSearch,
      },
      replace: true,
    });
  };

  const navigation = (compact = false) => (
    <nav aria-label={translate(locale, "appName")} className={compact ? "space-y-1" : "space-y-1"}>
      {sections.map((item) => (
        <Link
          key={item}
          to={item === "settings" ? "/app/settings" : `/app/${item}`}
          search={{
            period: filters.period,
            locationId: filters.locationId,
            ...(item === "settings" ? { panel: undefined } : {}),
          }}
          onClick={() => setDrawerOpen(false)}
          data-tour={item === "locations" ? "navigation-locations" : undefined}
          className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-amber-50 hover:text-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"
          activeProps={{ className: "bg-amber-100 text-amber-950" }}
        >
          {translate(locale, `navigation.${item}`)}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f7f3ee] text-stone-900">
      <a className="skip-link" href="#main-content">
        {translate(locale, "public.skipToContent")}
      </a>
      <aside className="fixed inset-y-0 hidden w-64 border-r border-stone-200 bg-[#fffaf2] p-4 xl:flex xl:flex-col">
        <div className="flex items-center gap-2 px-3 py-3 text-lg font-semibold">
          <Coffee className="size-5 text-amber-900" aria-hidden="true" />
          {translate(locale, "appName")}
        </div>
        <div className="mt-6 flex-1">{navigation()}</div>
        <ShellActions
          locale={locale}
          onFeedback={() =>
            void navigate({
              to: "/app/settings",
              search: { period: filters.period, locationId: filters.locationId, panel: "feedback" },
            })
          }
          onLogout={() => logoutMutation.mutate()}
          pending={logoutMutation.isPending}
        />
      </aside>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#fffaf2]/95 backdrop-blur xl:ml-64">
        <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="icon-button xl:hidden"
                aria-label={translate(locale, "actions.openNavigation")}
              >
                <Menu className="size-5" />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/35" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col bg-[#fffaf2] p-4 shadow-xl focus:outline-none">
                <div className="flex items-center justify-between px-2 py-2">
                  <Dialog.Title className="font-semibold">
                    {translate(locale, "appName")}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={translate(locale, "actions.close")}
                    >
                      <X className="size-5" />
                    </button>
                  </Dialog.Close>
                </div>
                <div className="mt-5 flex-1">{navigation(true)}</div>
                <ShellActions
                  locale={locale}
                  onFeedback={() => {
                    setDrawerOpen(false);
                    void navigate({
                      to: "/app/settings",
                      search: {
                        period: filters.period,
                        locationId: filters.locationId,
                        panel: "feedback",
                      },
                    });
                  }}
                  onLogout={() => logoutMutation.mutate()}
                  pending={logoutMutation.isPending}
                />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-stone-950">
              {translate(locale, `navigation.${section}`)}
            </p>
          </div>
          <AlertsControl locale={locale} query={alerts} />
        </div>
        {isAnalytics && (
          <div
            data-tour="overview-filters"
            className="flex flex-wrap gap-3 border-t border-stone-100 px-4 py-3 sm:px-6"
          >
            <label className="grid min-w-36 gap-1 text-xs font-medium text-stone-700">
              {translate(locale, "filters.location")}
              <select
                value={filters.locationId ?? ""}
                onChange={(event) => updateFilters({ locationId: event.target.value || null })}
                className="control"
              >
                <option value="">{translate(locale, "filters.allLocations")}</option>
                {locations.data?.map((location) => (
                  <option key={location.locationId} value={location.locationId}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-32 gap-1 text-xs font-medium text-stone-700">
              {translate(locale, "filters.period")}
              <select
                value={filters.period}
                onChange={(event) =>
                  updateFilters({ period: event.target.value as AnalyticsFilters["period"] })
                }
                className="control"
              >
                {periods.map((period) => (
                  <option key={period} value={period}>
                    {translate(locale, `filters.${periodKey[period]}`)}
                  </option>
                ))}
              </select>
            </label>
            {locations.isError && (
              <div className="self-end">
                <Button size="sm" variant="outline" onClick={() => void locations.refetch()}>
                  {translate(locale, "actions.retry")}
                </Button>
              </div>
            )}
          </div>
        )}
      </header>
      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 xl:ml-64 xl:w-[calc(100%-16rem)]"
      >
        {logoutMutation.isError && (
          <div className="mb-4">
            <ErrorState locale={locale} error={logoutMutation.error} />
          </div>
        )}
        <Outlet />
      </main>
      <GuidedTour
        key={profile.tourState}
        locale={locale}
        open={tourOpen}
        onNavigate={(route) =>
          navigate({
            to: route,
            search: { period: filters.period, locationId: filters.locationId },
          })
        }
        onPersist={persistTourState}
      />
    </div>
  );
}

function ShellActions({
  locale,
  onFeedback,
  onLogout,
  pending,
}: {
  locale: ReturnType<typeof localeFromProfile>;
  onFeedback: () => void;
  onLogout: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-2 border-t border-stone-200 pt-3">
      <Button
        data-tour="feedback"
        type="button"
        variant="outline"
        className="w-full justify-start"
        onClick={onFeedback}
      >
        <MessageSquare className="mr-2 size-4" />
        {translate(locale, "actions.feedback")}
      </Button>
      <PendingButton
        type="button"
        variant="outline"
        className="w-full justify-start"
        onClick={onLogout}
        pending={pending}
        pendingLabel={translate(locale, "states.loading")}
      >
        <LogOut className="mr-2 size-4" />
        {translate(locale, "actions.logout")}
      </PendingButton>
    </div>
  );
}

type OverviewResponse = z.infer<typeof overviewResponseSchema>;

function AlertsControl({
  locale,
  query,
}: {
  locale: ReturnType<typeof localeFromProfile>;
  query: UseQueryResult<OverviewResponse>;
}) {
  const data = query.data?.data;
  const total = data?.kpis.activeAlerts.value ?? 0;
  const alerts = data?.alerts ?? [];
  const labels = {
    LOW_STOCK: "alerts.lowStock",
    OUT_OF_STOCK: "alerts.outOfStock",
    SALES_DROP: "alerts.salesDrop",
  } as const;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="icon-button relative"
          aria-label={`${translate(locale, "alerts.label")}: ${total}`}
        >
          <Bell className="size-5" />
          {total > 0 && (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-700 px-1 text-xs font-bold text-white">
              {total}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          className="z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-4 shadow-lg"
        >
          <h2 className="font-semibold">{translate(locale, "alerts.label")}</h2>
          {query.isPending && (
            <p className="mt-3 text-sm text-stone-600">{translate(locale, "states.loading")}</p>
          )}
          {query.isError && (
            <div className="mt-3">
              <ErrorState
                locale={locale}
                error={query.error}
                onRetry={() => void query.refetch()}
              />
            </div>
          )}
          {query.isSuccess &&
            (alerts.length ? (
              <div className="mt-3 space-y-2">
                {alerts.map((alert) => (
                  <div key={alert.id} className="rounded-lg bg-stone-50 p-3 text-sm">
                    <p className="font-medium">{translate(locale, labels[alert.type])}</p>
                    <p className="text-stone-600">
                      {alert.locationName}
                      {alert.entityName ? ` · ${alert.entityName}` : ""}
                    </p>
                  </div>
                ))}
                {total > alerts.length && (
                  <p className="text-xs text-stone-600">
                    {translate(locale, "alerts.showing", { shown: alerts.length, total })}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-600">{translate(locale, "alerts.none")}</p>
            ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
