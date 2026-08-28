/* eslint-disable react-refresh/only-export-components */
import { createLazyRoute } from "@tanstack/react-router";

import type { AnalyticsFilters } from "@/api/analytics";
import { SalesPage } from "@/components/sales-page";

export const Route = createLazyRoute("/app/sales")({ component: SalesRoute });

function SalesRoute() {
  const search = Route.useSearch();
  const filters: AnalyticsFilters = {
    period: search.period,
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };

  return <SalesPage filters={filters} />;
}
