import { queryOptions } from "@tanstack/react-query";
import {
  locationsResponseSchema,
  overviewResponseSchema,
  type AnalyticsQuery,
  type LocationsData,
} from "@brew-dashboard/contracts";
import { requestApi } from "./client";

export type AnalyticsPeriod = AnalyticsQuery["period"];
export type AnalyticsFilters = { period: AnalyticsPeriod; locationId?: string | undefined };
export type LocationSorting = Pick<LocationsData, "sortBy" | "sortDir">;

const queryString = (filters: AnalyticsFilters & Partial<LocationSorting>) => {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.locationId) params.set("locationId", filters.locationId);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
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

export const locationsQuery = (networkId: string, filters: AnalyticsFilters & LocationSorting) =>
  queryOptions({
    queryKey: ["tenant", networkId, "locations", filters],
    queryFn: ({ signal }) =>
      requestApi({
        path: `/api/v1/locations?${queryString(filters)}`,
        schema: locationsResponseSchema,
        signal,
      }),
  });
