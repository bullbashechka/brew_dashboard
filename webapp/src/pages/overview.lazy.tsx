/* eslint-disable react-refresh/only-export-components */
import { createLazyRoute } from "@tanstack/react-router";

import type { AnalyticsFilters } from "@/api/analytics";
import { OverviewPage } from "@/components/overview-page";

export { OverviewMetricCard } from "@/components/overview-page";

export const Route = createLazyRoute("/app/overview")({
  component: OverviewRoute,
});

function OverviewRoute() {
  const search = Route.useSearch();
  const filters: AnalyticsFilters = {
    period: search.period,
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };

  return <OverviewPage filters={filters} />;
}
