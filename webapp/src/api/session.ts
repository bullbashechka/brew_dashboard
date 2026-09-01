import { queryOptions } from "@tanstack/react-query";
import {
  authMeResponseSchema,
  logoutResponseSchema,
  type Profile,
} from "@brew-dashboard/contracts";
import { ApiClientError, requestApi } from "./client";

export const sessionQueryKey = ["session"] as const;

export type MfaSetupState = { mfaSetupRequired: true };
export type AuthState = Profile | MfaSetupState | null;

export const profileFromAuthState = (state: AuthState): Profile | null =>
  state && "mfaSetupRequired" in state ? null : state;

export const isMfaSetupState = (state: AuthState): state is MfaSetupState =>
  Boolean(state && "mfaSetupRequired" in state);

export async function fetchAuthState(signal?: AbortSignal): Promise<AuthState> {
  try {
    const response = await requestApi({
      path: "/api/v1/auth/me",
      schema: authMeResponseSchema,
      unauthorized: "guest",
      ...(signal ? { signal } : {}),
    });
    return "mfaSetupRequired" in response.data ? response.data : response.data.profile;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export const fetchSession = async (signal?: AbortSignal): Promise<Profile | null> =>
  profileFromAuthState(await fetchAuthState(signal));

export const authStateQueryOptions = () =>
  queryOptions({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchAuthState(signal),
    staleTime: 60_000,
    retry: false,
  });

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchAuthState(signal),
    select: profileFromAuthState,
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
