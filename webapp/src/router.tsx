import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
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
import {
  authStateQueryOptions,
  isMfaSetupState,
  profileFromAuthState,
  sessionQueryKey,
  sessionQueryOptions,
  type AuthState,
} from "@/api/session";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AppShell } from "@/components/app-shell";
import { NotFoundPage } from "@/components/not-found-page";
import { localeFromProfile, translate } from "@/lib/i18n";
import { LanguagePage, LoginPage, MfaSetupPage, OnboardingPage } from "@/pages/first-run";

export type AppRouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
  pendingComponent: RootPending,
  errorComponent: RootError,
  notFoundComponent: NotFoundPage,
});

const getAuthState = (queryClient: QueryClient) =>
  queryClient.ensureQueryData(authStateQueryOptions());

export const destinationFor = (state: AuthState) => {
  if (isMfaSetupState(state)) return { to: "/mfa/setup" as const };
  const profile = profileFromAuthState(state);
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

const redirectToDestination = (state: AuthState) => {
  throw redirect(destinationFor(state));
};

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => redirectToDestination(await getAuthState(context.queryClient)),
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
    const state = await getAuthState(context.queryClient);
    if (state) redirectToDestination(state);
  },
  component: LoginPage,
});

const languageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run/language",
  beforeLoad: async ({ context }) => {
    const state = await getAuthState(context.queryClient);
    const profile = profileFromAuthState(state);
    if (!profile || profile.language) redirectToDestination(state);
  },
  component: LanguagePage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run/onboarding",
  beforeLoad: async ({ context }) => {
    const state = await getAuthState(context.queryClient);
    const profile = profileFromAuthState(state);
    if (!profile || !profile.language || profile.onboardingCompletedAt)
      redirectToDestination(state);
  },
  component: OnboardingPage,
});

const mfaSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mfa/setup",
  beforeLoad: async ({ context }) => {
    const state = await getAuthState(context.queryClient);
    if (!isMfaSetupState(state)) redirectToDestination(state);
  },
  component: MfaSetupPage,
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
    const state = await getAuthState(context.queryClient);
    const profile = profileFromAuthState(state);
    assertCompleteProfileConfiguration(profile);
    if (!profile || !profile.language || !profile.onboardingCompletedAt)
      redirectToDestination(state);
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
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: "settings" }).lazy(() =>
  import("./pages/settings.lazy").then((module) => module.Route),
);

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  languageRoute,
  onboardingRoute,
  mfaSetupRoute,
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
  const profile = profileFromAuthState(
    queryClient.getQueryData<AuthState>(sessionQueryKey) ?? null,
  );
  return <LoadingState locale={localeFromProfile(profile)} />;
}

function RootError({ error }: { error: unknown }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const profile = profileFromAuthState(
    queryClient.getQueryData<AuthState>(sessionQueryKey) ?? null,
  );
  const locale = localeFromProfile(profile);

  const retry = () => {
    queryClient.removeQueries({ queryKey: sessionQueryKey, exact: true });
    void router.invalidate({ forcePending: true });
  };

  return <ErrorState locale={locale} error={error} onRetry={retry} />;
}
