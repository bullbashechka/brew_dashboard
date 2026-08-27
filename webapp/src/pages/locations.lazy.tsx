/* eslint-disable react-refresh/only-export-components */
import { createLazyRoute, useNavigate } from "@tanstack/react-router";

import type { AnalyticsFilters, LocationSorting } from "@/api/analytics";
import { LocationsPage } from "@/components/locations-page";

export { LocationsPerformanceBadge } from "@/components/locations-page";

export const Route = createLazyRoute("/app/locations")({
  component: LocationsRoute,
});

function LocationsRoute() {
  const navigate = useNavigate({ from: "/app/locations" });
  const search = Route.useSearch();
  const filters: AnalyticsFilters = {
    period: search.period,
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };
  const sorting: LocationSorting = {
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  };

  return (
    <LocationsPage
      filters={filters}
      sorting={sorting}
      onSortingChange={(next) => {
        void navigate({
          to: "/app/locations",
          search: { period: filters.period, locationId: filters.locationId, ...sorting, ...next },
          replace: true,
        });
      }}
    />
  );
}
