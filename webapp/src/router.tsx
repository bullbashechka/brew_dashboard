import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { periodSchema, type Profile } from "@brew-dashboard/contracts";
import { sessionQueryOptions } from "@/api/session";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AppShell } from "@/components/app-shell";
import { localeFromProfile, translate } from "@/lib/i18n";

export type AppRouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
  pendingComponent: () => <LoadingState locale="en" />,
  errorComponent: ({ error }) => <ErrorState locale="en" error={error} />,
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
  component: () => <PublicFoundation kind="login" />,
});

const languageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run/language",
  beforeLoad: async ({ context }) => {
    const profile = await getSession(context.queryClient);
    if (!profile || profile.language) redirectToDestination(profile);
  },
  component: () => <PublicFoundation kind="language" />,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/first-run/onboarding",
  beforeLoad: async ({ context }) => {
    const profile = await getSession(context.queryClient);
    if (!profile || !profile.language || profile.onboardingCompletedAt)
      redirectToDestination(profile);
  },
  component: () => <PublicFoundation kind="onboarding" />,
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
const locationsRoute = createRoute({ getParentRoute: () => appRoute, path: "locations" }).lazy(() =>
  import("./pages/locations.lazy").then((module) => module.Route),
);
const salesRoute = createRoute({ getParentRoute: () => appRoute, path: "sales" }).lazy(() =>
  import("./pages/sales.lazy").then((module) => module.Route),
);
const productsRoute = createRoute({ getParentRoute: () => appRoute, path: "products" }).lazy(() =>
  import("./pages/products.lazy").then((module) => module.Route),
);
const inventoryRoute = createRoute({ getParentRoute: () => appRoute, path: "inventory" }).lazy(() =>
  import("./pages/inventory.lazy").then((module) => module.Route),
);
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

function PublicFoundation({ kind }: { kind: "login" | "language" | "onboarding" }) {
  const { data: profile } = useQuery(sessionQueryOptions());
  const locale = localeFromProfile(profile);
  const copy = {
    login: "states.signIn",
    language: "states.language",
    onboarding: "states.onboarding",
  } as const;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
      <section className="w-full rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-800">
          Brew Dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-stone-950">
          {translate(locale, kind === "login" ? "public.signIn" : "public.firstRun")}
        </h1>
        <p className="mt-3 text-stone-600">{translate(locale, copy[kind])}</p>
      </section>
    </main>
  );
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
