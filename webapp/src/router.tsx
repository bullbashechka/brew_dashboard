import { useQuery } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { fetchHealth } from "@/api/health";
import { Button } from "@/components/ui/button";

function AppShell() {
  return (
    <div className="min-h-screen bg-[#f7f3ee]">
      <header className="border-b border-stone-200 bg-white/80">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link className="font-semibold tracking-tight text-stone-900" to="/">
            Brew Dashboard
          </Link>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
            Foundation
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}

function HomePage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
  });

  return (
    <section className="max-w-2xl space-y-6">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-800">
          MVP foundation
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
          Brew Dashboard
        </h1>
        <p className="max-w-xl text-base leading-7 text-stone-600">
          The shared Worker origin and the React shell are ready for the product stages that follow.
        </p>
      </div>
      <div
        aria-live="polite"
        className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
        data-testid="api-status"
      >
        {health.isPending && <p className="text-stone-600">Checking API…</p>}
        {health.isError && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-red-700">API unavailable</p>
            <Button onClick={() => void health.refetch()} variant="outline" size="sm">
              Retry
            </Button>
          </div>
        )}
        {health.isSuccess && <p className="text-emerald-700">API ready</p>}
      </div>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section className="space-y-4">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-800">404</p>
      <h1 className="text-3xl font-semibold text-stone-950">Page not found</h1>
      <Link to="/" className="inline-flex text-amber-900 underline underline-offset-4">
        Return to the foundation shell
      </Link>
    </section>
  );
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
