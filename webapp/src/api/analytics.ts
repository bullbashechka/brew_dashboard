import { queryOptions } from "@tanstack/react-query";
import { locationsResponseSchema, overviewResponseSchema } from "@brew-dashboard/contracts";
import { requestApi } from "./client";

export type AnalyticsPeriod = "today" | "7d" | "30d" | "6m";
export type AnalyticsFilters = { period: AnalyticsPeriod; locationId?: string | undefined };

const queryString = (filters: AnalyticsFilters) => {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.locationId) params.set("locationId", filters.locationId);
  return params.toString();
};

export const locationOptionsQuery = (networkId: string) =>
  queryOptions({
    queryKey: ["tenant", networkId, "location-options"],
    queryFn: ({ signal }) =>
      requestApi({
        path: "/api/v1/locations?period=today",
        schema: locationsResponseSchema,
        signal,
      }),
    select: (response) =>
      response.data.locations.map(({ locationId, name }) => ({ locationId, name })),
    staleTime: 30 * 60_000,
  });

export const overviewQuery = (networkId: string, filters: AnalyticsFilters) =>
  queryOptions({
    queryKey: ["tenant", networkId, "overview", filters],
    queryFn: ({ signal }) =>
      requestApi({
        path: `/api/v1/overview?${queryString(filters)}`,
        schema: overviewResponseSchema,
        signal,
      }),
  });
