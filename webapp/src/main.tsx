import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import "./index.css";
import { router } from "./router";
import { setSessionExpiredHandler } from "./api/client";
import { subscribeSessionBoundary } from "./lib/session-boundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        error instanceof Error && "status" in error && (error as { status?: number }).status
          ? false
          : failureCount < 1,
    },
  },
});

setSessionExpiredHandler(async () => {
  await queryClient.cancelQueries();
  queryClient.clear();
  const currentPath = router.state.location.href;
  const redirect = currentPath.startsWith("/app/") ? currentPath : undefined;
  await router.navigate({ to: "/login", search: { redirect }, replace: true });
});
const unsubscribeSessionBoundary = subscribeSessionBoundary(async () => {
  await queryClient.cancelQueries();
  queryClient.clear();
  await router.navigate({ to: "/login", search: { redirect: undefined }, replace: true });
});
const onPageHide = (event: PageTransitionEvent) => {
  // Keep the listener alive for bfcache restores; otherwise a tab can return with stale
  // authenticated UI after another tab has logged out. Cleanup is needed only on final unload.
  if (event.persisted) return;
  unsubscribeSessionBoundary();
  window.removeEventListener("pagehide", onPageHide);
};
window.addEventListener("pagehide", onPageHide);
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ queryClient }} />
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
