import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Bell, Coffee, LogOut, Menu, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { locationOptionsQuery, overviewQuery, type AnalyticsFilters } from "@/api/analytics";
import type { z } from "zod";
import { overviewResponseSchema, type Profile, type TourState } from "@brew-dashboard/contracts";
import { logout, sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { saveTourState } from "@/api/tour";
import { feedbackQuery } from "@/api/settings";
import { FeedbackDialog } from "@/components/feedback";
import { GuidedTour } from "@/components/guided-tour";
import { ErrorState, LoadingState, PendingButton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { localeFromProfile, translate } from "@/lib/i18n";
import {
  dismissFeedbackPrompt,
  feedbackMutationEvent,
  readFeedbackPromptState,
  recordFeedbackSection,
} from "@/lib/feedback-prompt";
import { useQueryClient } from "@tanstack/react-query";
import { productEventDispatcher } from "@/lib/product-events";
import { acquireLogoutLock, announceLogout, releaseLogoutLock } from "@/lib/session-boundary";

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
  const search = useSearch({ strict: false });
  const section = sectionFromPath(pathname);
  const isAnalytics = analyticsSections.has(section);
  const filters = useMemo<AnalyticsFilters>(
    () => ({
      period: search.period ?? "today",
      ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
    }),
    [search.locationId, search.period],
  );
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const feedback = useQuery({
    ...feedbackQuery(profile?.networkId ?? "pending"),
    enabled: Boolean(profile),
  });
  const inventoryStatus = search.status;
  const locations = useQuery({
    ...locationOptionsQuery(profile?.networkId ?? "pending"),
    enabled: Boolean(profile),
  });
  const alerts = useQuery({
    ...overviewQuery(profile?.networkId ?? "pending", filters),
    enabled: Boolean(profile),
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [promptState, setPromptState] = useState({
    sections: [] as string[],
    mutations: 0,
    dismissed: false,
  });
  const lastSectionEvent = useRef<Section | null>(null);
  // Keep an in-progress tour mounted while it navigates between its three routes.
  // The persisted state remains `pending` until the user finishes or skips it.
  const tourOpen = profile?.tourState === "pending";

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
      search: {
        period: filters.period,
        locationId: undefined,
        ...(inventoryStatus ? { status: inventoryStatus } : {}),
      },
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
    inventoryStatus,
    pathname,
  ]);

  useEffect(() => {
    if (!profile) return;
    const nextPromptState = recordFeedbackSection(profile.networkId, section);
    const updatePrompt = window.setTimeout(() => setPromptState(nextPromptState), 0);
    if (lastSectionEvent.current === section) return;
    lastSectionEvent.current = section;
    productEventDispatcher.dispatch({
      eventId: crypto.randomUUID(),
      type: "section_viewed",
      route: section,
      metadata: { section },
    });
    return () => window.clearTimeout(updatePrompt);
  }, [profile, section]);

  useEffect(() => {
    if (!profile) return;
    const onMutation = (event: Event) => {
      const detail = (event as CustomEvent<{ networkId?: string }>).detail;
      if (detail?.networkId !== profile.networkId) return;
      setPromptState(readFeedbackPromptState(profile.networkId));
    };
    window.addEventListener(feedbackMutationEvent, onMutation);
    return () => window.removeEventListener(feedbackMutationEvent, onMutation);
  }, [profile]);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSettled: async () => {
      releaseLogoutLock();
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({ to: "/login", search: { redirect: undefined }, replace: true });
    },
  });

  const startLogout = () => {
    if (!acquireLogoutLock()) return;
    announceLogout();
    logoutMutation.mutate();
  };

  if (!profile) return <LoadingState locale={locale} />;

  const showFeedbackPrompt =
    feedback.isSuccess &&
    feedback.data.data === null &&
    section !== "settings" &&
    !feedbackOpen &&
    !promptState.dismissed &&
    (promptState.sections.length >= 3 || promptState.mutations >= 2);

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
            sortBy: search.sortBy ?? "revenue",
            sortDir: search.sortDir ?? "desc",
          }
        : {};
    void navigate({
      to: pathname,
      search: {
        period: next.period ?? filters.period,
        locationId: next.locationId === null ? undefined : (next.locationId ?? filters.locationId),
        ...locationsSearch,
        ...(inventoryStatus ? { status: inventoryStatus } : {}),
      },
      replace: true,
    });
    const filter = next.period !== undefined ? "period" : "location";
    const nextPeriod = next.period ?? filters.period;
    const nextLocationId =
      next.locationId === null ? null : (next.locationId ?? filters.locationId ?? null);
    productEventDispatcher.dispatch({
      eventId: crypto.randomUUID(),
      type: "filter_changed",
      route: section,
      metadata: { filter, period: nextPeriod, locationId: nextLocationId },
    });
  };

  const navigation = () => (
    <nav aria-label={translate(locale, "appName")} className="space-y-1">
      {sections.map((item) => (
        <Link
          key={item}
          to={item === "settings" ? "/app/settings" : `/app/${item}`}
          search={{
            period: filters.period,
            locationId: filters.locationId,
            ...(item === "inventory" && section === "inventory" && inventoryStatus
              ? { status: inventoryStatus }
              : {}),
          }}
          onClick={() => setDrawerOpen(false)}
          data-tour={item === "locations" ? "navigation-locations" : undefined}
          className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          activeProps={{
            className: "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]",
          }}
        >
          {translate(locale, `navigation.${item}`)}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
      <a className="skip-link" href="#main-content">
        {translate(locale, "public.skipToContent")}
      </a>
      <aside className="fixed inset-y-0 hidden w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 xl:flex xl:flex-col">
        <div className="flex items-center gap-2 px-3 py-3 text-lg font-semibold">
          <Coffee className="size-5 text-[var(--color-accent)]" aria-hidden="true" />
          {translate(locale, "appName")}
        </div>
        <div className="mt-6 flex-1">{navigation()}</div>
        <ShellActions
          locale={locale}
          onFeedback={() => setFeedbackOpen(true)}
          onLogout={startLogout}
          pending={logoutMutation.isPending}
        />
      </aside>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_95%,transparent)] backdrop-blur xl:ml-64">
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
              <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--color-overlay)]" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[var(--drawer-width)] flex-col bg-[var(--color-surface)] p-4 shadow-[var(--shadow-dialog)] focus:outline-none">
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
                <div className="mt-5 flex-1">{navigation()}</div>
                <ShellActions
                  locale={locale}
                  onFeedback={() => {
                    setDrawerOpen(false);
                    setFeedbackOpen(true);
                  }}
                  onLogout={startLogout}
                  pending={logoutMutation.isPending}
                />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">
              {translate(locale, `navigation.${section}`)}
            </p>
          </div>
          <AlertsControl locale={locale} query={alerts} />
        </div>
        {isAnalytics && (
          <div
            data-tour="overview-filters"
            className="grid gap-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-canvas)] px-4 py-3 min-[480px]:grid-cols-2 sm:px-6 xl:flex"
          >
            <label className="grid min-w-0 gap-1 text-xs font-medium text-[var(--color-text-secondary)] xl:min-w-44">
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
            <label className="grid min-w-0 gap-1 text-xs font-medium text-[var(--color-text-secondary)] xl:min-w-40">
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
        className="mx-auto w-full max-w-[var(--container-app)] px-4 py-6 sm:px-6 xl:ml-64 xl:w-[calc(100%-16rem)] xl:px-8 xl:py-8"
      >
        {logoutMutation.isError && (
          <div className="mb-4">
            <ErrorState locale={locale} error={logoutMutation.error} />
          </div>
        )}
        {showFeedbackPrompt && (
          <div className="mb-6">
            <FeedbackPrompt
              locale={locale}
              onClose={() => setPromptState(dismissFeedbackPrompt(profile.networkId))}
              onOpen={() => setFeedbackOpen(true)}
            />
          </div>
        )}
        <Outlet />
      </main>
      <FeedbackDialog
        profile={profile}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onSubmitted={() => setPromptState(dismissFeedbackPrompt(profile.networkId))}
      />
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

function FeedbackPrompt({
  locale,
  onClose,
  onOpen,
}: {
  locale: ReturnType<typeof localeFromProfile>;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <aside
      className="rounded-xl border border-[var(--color-info-border)] bg-[var(--color-info-surface)] p-4 text-[var(--color-info)]"
      aria-label={translate(locale, "feedback.promptTitle")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{translate(locale, "feedback.promptTitle")}</p>
          <p className="mt-1 text-sm">{translate(locale, "feedback.promptDescription")}</p>
        </div>
        <button
          type="button"
          className="icon-button shrink-0"
          aria-label={translate(locale, "actions.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3">
        <Button type="button" onClick={onOpen}>
          {translate(locale, "actions.feedback")}
        </Button>
      </div>
    </aside>
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
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <Button
        data-tour="feedback"
        type="button"
        variant="sidebar"
        icon={MessageSquare}
        onClick={onFeedback}
      >
        {translate(locale, "actions.feedback")}
      </Button>
      <PendingButton
        type="button"
        variant="sidebar"
        icon={LogOut}
        onClick={onLogout}
        pending={pending}
        pendingLabel={translate(locale, "states.loading")}
      >
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
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--color-danger)] px-1 text-xs font-bold text-white">
              {total}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          className="z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--shadow-popover)]"
        >
          <h2 className="font-semibold">{translate(locale, "alerts.label")}</h2>
          {query.isPending && (
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              {translate(locale, "states.loading")}
            </p>
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
                  <div
                    key={alert.id}
                    className="rounded-lg bg-[var(--color-surface-subtle)] p-3 text-sm"
                  >
                    <p className="font-medium">{translate(locale, labels[alert.type])}</p>
                    <p className="text-[var(--color-text-secondary)]">
                      {alert.locationName}
                      {alert.entityName ? ` · ${alert.entityName}` : ""}
                    </p>
                  </div>
                ))}
                {total > alerts.length && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {translate(locale, "alerts.showing", { shown: alerts.length, total })}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                {translate(locale, "alerts.none")}
              </p>
            ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
