import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import {
  locationSortBySchema,
  periodSchema,
  sortDirectionSchema,
  stockStatusSchema,
  type Profile,
} from "@brew-dashboard/contracts";
import { sessionQueryKey, sessionQueryOptions } from "@/api/session";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AppShell } from "@/components/app-shell";
import { localeFromProfile, translate } from "@/lib/i18n";
import { LanguagePage, LoginPage, OnboardingPage } from "@/pages/first-run";

export type AppRouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
  pendingComponent: RootPending,
  errorComponent: RootError,
  notFoundComponent: NotFoundPage,
});

const getSession = (queryClient: QueryClient) => queryClient.ensureQueryData(sessionQueryOptions());

const destinationFor = (profile: Profile | null) => {
  if (!profile) return { to: "/login" as const };
  if (!profile.language) return { to: "/first-run/language" as const };
  if (!profile.onboardingCompletedAt) return { to: "/first-run/onboarding" as const };
  return { to: "/app/overview" as const, search: { period: "today" as const } };
};

const assertCompleteProfileConfiguration = (profile: Profile | null) => {
  if (profile?.onboardingCompletedAt && (!profile.currency || !profile.timeZone)) {
    throw new Error("Completed profile is missing currency or timezone configuration");
  }
};

const redirectToDestination = (profile: Profile | null) => {
  throw redirect(destinationFor(profile));
};

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => redirectToDestination(await getSession(context.queryClient)),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      typeof search.redirect === "string" && safeRedirect(search.redirect)
        ? search.redirect
        : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const profile = await getSession(context.queryClient);
    if (profile) redirectToDestination(profile);
  },
  component: LoginPage,
});

const languageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run/language",
  beforeLoad: async ({ context }) => {
    const profile = await getSession(context.queryClient);
    if (!profile || profile.language) redirectToDestination(profile);
  },
  component: LanguagePage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run/onboarding",
  beforeLoad: async ({ context }) => {
    const profile = await getSession(context.queryClient);
    if (!profile || !profile.language || profile.onboardingCompletedAt)
      redirectToDestination(profile);
  },
  component: OnboardingPage,
});

const appSearch = (search: Record<string, unknown>) => ({
  period: periodSchema.safeParse(search.period).data ?? "today",
  locationId:
    typeof search.locationId === "string" && search.locationId.trim()
      ? search.locationId
      : undefined,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  validateSearch: appSearch,
  beforeLoad: async ({ context }) => {
    const profile = await getSession(context.queryClient);
    assertCompleteProfileConfiguration(profile);
    if (!profile || !profile.language || !profile.onboardingCompletedAt)
      redirectToDestination(profile);
  },
  component: AppShell,
});

const overviewRoute = createRoute({ getParentRoute: () => appRoute, path: "overview" }).lazy(() =>
  import("./pages/overview.lazy").then((module) => module.Route),
);
const locationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "locations",
  validateSearch: (search: Record<string, unknown>) => ({
    sortBy: locationSortBySchema.safeParse(search.sortBy).data ?? "revenue",
    sortDir: sortDirectionSchema.safeParse(search.sortDir).data ?? "desc",
  }),
}).lazy(() => import("./pages/locations.lazy").then((module) => module.Route));
const salesRoute = createRoute({ getParentRoute: () => appRoute, path: "sales" }).lazy(() =>
  import("./pages/sales.lazy").then((module) => module.Route),
);
const productsRoute = createRoute({ getParentRoute: () => appRoute, path: "products" }).lazy(() =>
  import("./pages/products.lazy").then((module) => module.Route),
);
const inventoryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "inventory",
  validateSearch: (search: Record<string, unknown>) => ({
    status: stockStatusSchema.safeParse(search.status).data ?? undefined,
  }),
}).lazy(() => import("./pages/inventory.lazy").then((module) => module.Route));
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "settings",
  validateSearch: (search: Record<string, unknown>) => ({
    panel: search.panel === "feedback" ? "feedback" : undefined,
  }),
}).lazy(() => import("./pages/settings.lazy").then((module) => module.Route));

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  languageRoute,
  onboardingRoute,
  appRoute.addChildren([
    overviewRoute,
    locationsRoute,
    salesRoute,
    productsRoute,
    inventoryRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient: undefined! },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function safeRedirect(value: string) {
  return value.startsWith("/app/") && !value.startsWith("//") && !value.includes("\\");
}

function RootLayout() {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "appName");
  }, [locale]);
  return <Outlet />;
}

function RootPending() {
  const queryClient = useQueryClient();
  const profile = queryClient.getQueryData<Profile | null>(sessionQueryKey);
  return <LoadingState locale={localeFromProfile(profile)} />;
}

function RootError({ error }: { error: unknown }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const profile = queryClient.getQueryData<Profile | null>(sessionQueryKey);
  const locale = localeFromProfile(profile);

  const retry = () => {
    queryClient.removeQueries({ queryKey: sessionQueryKey, exact: true });
    void router.invalidate({ forcePending: true });
  };

  return <ErrorState locale={locale} error={error} onRetry={retry} />;
}

function NotFoundPage() {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
      <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-800">404</p>
        <h1 className="text-3xl font-semibold text-stone-950">
          {translate(locale, "routes.notFound")}
        </h1>
        <p className="text-stone-600">{translate(locale, "routes.notFoundDescription")}</p>
        <Link to="/" className="inline-flex text-amber-900 underline underline-offset-4">
          {translate(locale, "routes.returnHome")}
        </Link>
      </section>
    </main>
  );
}
