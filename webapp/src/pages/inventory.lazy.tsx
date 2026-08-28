/* eslint-disable react-refresh/only-export-components */
import { createLazyRoute, useNavigate } from "@tanstack/react-router";

import type { AnalyticsFilters, InventoryFilters } from "@/api/analytics";
import { InventoryPage } from "@/components/inventory-page";

export const Route = createLazyRoute("/app/inventory")({ component: InventoryRoute });

function InventoryRoute() {
  const navigate = useNavigate({ from: "/app/inventory" });
  const search = Route.useSearch();
  const filters: AnalyticsFilters = {
    period: search.period,
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };

  const updateStatus = (status?: InventoryFilters["status"]) => {
    void navigate({
      to: "/app/inventory",
      search: { period: filters.period, locationId: filters.locationId, status },
      replace: true,
    });
  };

  return <InventoryPage filters={filters} status={search.status} onStatusChange={updateStatus} />;
}
