import { parseLogin } from "../src/auth/login.ts";

export const parseProductionBaseUrl = (value: string | undefined) => {
  if (!value) throw new Error("PRODUCTION_E2E_BASE_URL is required");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.startsWith("brew-dashboard.") ||
    !url.hostname.endsWith(".workers.dev")
  ) {
    throw new Error(
      "PRODUCTION_E2E_BASE_URL must be the exact HTTPS brew-dashboard workers.dev origin",
    );
  }
  return url.origin;
};

export const parseProductionE2eLogin = (value: string | undefined) => {
  if (!value) throw new Error("--login is required");
  return parseLogin(value);
};
