import { healthResponseSchema, type HealthResponse } from "@brew-dashboard/contracts";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health", {
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json();

  if (!response.ok) {
    throw new Error("Health request failed");
  }

  return healthResponseSchema.parse(body);
}
