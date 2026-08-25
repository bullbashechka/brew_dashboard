import { queryOptions } from "@tanstack/react-query";
import {
  logoutResponseSchema,
  sessionResponseSchema,
  type Profile,
} from "@brew-dashboard/contracts";
import { ApiClientError, requestApi } from "./client";

export const sessionQueryKey = ["session"] as const;

export async function fetchSession(signal?: AbortSignal): Promise<Profile | null> {
  try {
    const response = await requestApi({
      path: "/api/v1/auth/me",
      schema: sessionResponseSchema,
      unauthorized: "guest",
      ...(signal ? { signal } : {}),
    });
    return response.data.profile;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 60_000,
    retry: false,
  });

export const logout = (signal?: AbortSignal) =>
  requestApi({
    path: "/api/v1/auth/logout",
    method: "POST",
    body: {},
    schema: logoutResponseSchema,
    ...(signal ? { signal } : {}),
  });
