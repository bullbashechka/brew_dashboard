import type { WorkerBindings } from "../http/types.ts";
import { isLoopbackHostname } from "../security/hosts.ts";
import { authUrlFor } from "./environment.ts";

export const resolveMfaPolicy = (bindings: WorkerBindings) => {
  const value = bindings.MFA_REQUIRED;
  if (value === "1") return true;
  if (value !== "0") {
    throw new Error("MFA_REQUIRED must be explicitly configured as 1, or 0 for isolated local use");
  }
  const configuredUrl = authUrlFor(bindings);
  if (!configuredUrl || !URL.canParse(configuredUrl)) {
    throw new Error("MFA-disabled mode requires a valid local authentication URL");
  }
  if (!isLoopbackHostname(new URL(configuredUrl).hostname)) {
    throw new Error("MFA_REQUIRED=0 is allowed only for a loopback authentication URL");
  }
  return false;
};

export const allowsLocalRateLimitFallback = (bindings: WorkerBindings) => {
  try {
    return resolveMfaPolicy(bindings) === false;
  } catch {
    return false;
  }
};
