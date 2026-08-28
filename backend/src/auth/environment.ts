import type { WorkerBindings } from "../http/types.ts";

export const isSystemE2eEnvironment = (environment?: WorkerBindings) =>
  environment?.SYSTEM_E2E === "1";

export const authSecretFor = (environment?: WorkerBindings) =>
  isSystemE2eEnvironment(environment)
    ? environment?.SYSTEM_E2E_AUTH_SECRET
    : environment?.BETTER_AUTH_SECRET;

export const authUrlFor = (environment?: WorkerBindings) =>
  isSystemE2eEnvironment(environment)
    ? environment?.SYSTEM_E2E_AUTH_URL
    : environment?.BETTER_AUTH_URL;
