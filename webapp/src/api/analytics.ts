import { queryOptions } from "@tanstack/react-query";
import {
  locationsResponseSchema,
  overviewResponseSchema,
  inventoryMovementMutationResponseSchema,
  inventoryMovementMutationSchema,
  inventoryResponseSchema,
  priceMutationResponseSchema,
  priceMutationSchema,
  productsResponseSchema,
  salesResponseSchema,
  type AnalyticsQuery,
  type InventoryData,
  type InventoryMovementMutation,
  type LocationsData,
  type PriceMutation,
} from "@brew-dashboard/contracts";
import { requestApi } from "./client";

export const ANALYTICS_STALE_TIME = 30_000;
export const ANALYTICS_GC_TIME = 5 * 60_000;

export type AnalyticsPeriod = AnalyticsQuery["period"];
export type AnalyticsFilters = { period: AnalyticsPeriod; locationId?: string | undefined };
export type LocationSorting = Pick<LocationsData, "sortBy" | "sortDir">;
export type InventoryFilters = AnalyticsFilters & {
  status?: Exclude<InventoryData["status"], null> | undefined;
};

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
    gcTime: ANALYTICS_GC_TIME,
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
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: ANALYTICS_GC_TIME,
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
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: ANALYTICS_GC_TIME,
  });

export const salesInfiniteQuery = (networkId: string, filters: AnalyticsFilters) => ({
  queryKey: ["tenant", networkId, "sales", filters],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam: string | undefined }) => {
    const params = new URLSearchParams(queryString(filters));
    params.set("pageSize", "10");
    if (pageParam) params.set("cursor", pageParam);
    return requestApi({
      path: `/api/v1/sales?${params.toString()}`,
      schema: salesResponseSchema,
      signal,
    });
  },
  getNextPageParam: (lastPage: { meta: { pagination: { nextCursor: string | null } } }) =>
    lastPage.meta.pagination.nextCursor ?? undefined,
  staleTime: ANALYTICS_STALE_TIME,
  gcTime: ANALYTICS_GC_TIME,
});

export const productsQuery = (networkId: string, filters: AnalyticsFilters) =>
  queryOptions({
    queryKey: ["tenant", networkId, "products", filters],
    queryFn: ({ signal }) =>
      requestApi({
        path: `/api/v1/products?${queryString(filters)}`,
        schema: productsResponseSchema,
        signal,
      }),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: ANALYTICS_GC_TIME,
  });

export const inventoryInfiniteQuery = (networkId: string, filters: InventoryFilters) => ({
  queryKey: ["tenant", networkId, "inventory", filters],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam: string | undefined }) => {
    const params = new URLSearchParams(queryString(filters));
    params.set("pageSize", "20");
    if (filters.status) params.set("status", filters.status);
    if (pageParam) params.set("cursor", pageParam);
    return requestApi({
      path: `/api/v1/inventory?${params.toString()}`,
      schema: inventoryResponseSchema,
      signal,
    });
  },
  getNextPageParam: (lastPage: { meta: { pagination: { nextCursor: string | null } } }) =>
    lastPage.meta.pagination.nextCursor ?? undefined,
  staleTime: ANALYTICS_STALE_TIME,
  gcTime: ANALYTICS_GC_TIME,
});

export const updateProductPrice = (productId: string, request: PriceMutation) =>
  requestApi({
    path: `/api/v1/products/${productId}/price`,
    method: "PATCH",
    schema: priceMutationResponseSchema,
    body: priceMutationSchema.parse(request),
  });

export const createInventoryMovement = (request: InventoryMovementMutation) =>
  requestApi({
    path: "/api/v1/inventory/movements",
    method: "POST",
    schema: inventoryMovementMutationResponseSchema,
    body: inventoryMovementMutationSchema.parse(request),
  });
