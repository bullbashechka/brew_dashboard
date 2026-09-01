import { parseLogin } from "../src/auth/login.ts";

export const PRODUCTION_WORKER_HOST = "brew-dashboard.bullbashechka.workers.dev";

export const parseProductionBaseUrl = (value: string | undefined) => {
  if (!value) throw new Error("PRODUCTION_E2E_BASE_URL is required");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname !== PRODUCTION_WORKER_HOST
  ) {
    throw new Error(
      "PRODUCTION_E2E_BASE_URL must be the exact HTTPS brew-dashboard workers.dev origin",
    );
  }
  return url.origin;
};

export const assertProductionHealth = async (baseUrl: string) => {
  const response = await fetch(new URL("/api/v1/health", baseUrl), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Production health check failed with HTTP ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as {
    data?: { status?: unknown };
  } | null;
  if (body?.data?.status !== "ok") {
    throw new Error("Production health check returned an invalid response");
  }
  return response;
};

export const parseProductionE2eLogin = (value: string | undefined) => {
  if (!value) throw new Error("--login is required");
  return parseLogin(value);
};
