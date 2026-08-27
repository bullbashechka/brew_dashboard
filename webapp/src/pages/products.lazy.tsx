/* eslint-disable react-refresh/only-export-components */
import { createLazyRoute } from "@tanstack/react-router";

import type { AnalyticsFilters } from "@/api/analytics";
import { ProductsPage } from "@/components/products-page";

export const Route = createLazyRoute("/app/products")({ component: ProductsRoute });

function ProductsRoute() {
  const search = Route.useSearch();
  const filters: AnalyticsFilters = {
    period: search.period,
    ...(typeof search.locationId === "string" ? { locationId: search.locationId } : {}),
  };

  return <ProductsPage filters={filters} />;
}
