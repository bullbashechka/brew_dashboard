import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const placeholderHyperdriveIds = new Set(["", "<HYPERDRIVE_ID>", "your-hyperdrive-id"]);
const requiredHyperdriveBindings = new Set(["AUTH_HYPERDRIVE", "APP_HYPERDRIVE"]);
const runtimeRoleStages = new Set(["A", "B", "C"]);
export const productionWorkerHost = "brew-dashboard.bullbashechka.workers.dev";

const removeJsoncComments = (value) =>
  value
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1")
    .replace(/,\s*([}\]])/gu, "$1");

export const readReleaseConfig = (path) =>
  JSON.parse(removeJsoncComments(readFileSync(path, "utf8")));

export const productionBaseUrlFor = (config) => config.vars?.BETTER_AUTH_URL;

export const assertProductionBaseUrl = (value, workerName = "brew-dashboard") => {
  if (typeof value !== "string") {
    throw new Error("wrangler.jsonc must define vars.BETTER_AUTH_URL before production release");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname !== productionWorkerHost ||
    !url.hostname.startsWith(`${workerName}.`)
  ) {
    throw new Error("BETTER_AUTH_URL must be the exact HTTPS workers.dev origin for this Worker");
  }
  return url.origin;
};

const hyperdriveIdIsReal = (value) =>
  typeof value === "string" &&
  !placeholderHyperdriveIds.has(value.trim()) &&
  /^[a-f0-9]{32}$/iu.test(value.trim());

export const assertReleaseConfig = (
  config,
  { requireBaseUrl = true, requireFinalRuntimeSplit = false } = {},
) => {
  if (config.name !== "brew-dashboard") throw new Error("Worker name must remain brew-dashboard");
  if (typeof config.compatibility_date !== "string") {
    throw new Error("compatibility_date must be pinned");
  }
  if (config.workers_dev !== true || config.preview_urls !== false) {
    throw new Error("Production must use only workers.dev with preview URLs disabled");
  }
  if (config.env || config.route || config.routes || config.triggers) {
    throw new Error("Production config must not define environments, routes, or Cron triggers");
  }
  const durableBindings = config.durable_objects?.bindings;
  if (
    !Array.isArray(durableBindings) ||
    !durableBindings.some(
      (binding) => binding?.name === "RATE_LIMIT_ACTOR" && binding?.class_name === "RateLimitActor",
    ) ||
    !Array.isArray(config.migrations) ||
    !config.migrations.some(
      (migration) =>
        Array.isArray(migration?.new_classes) && migration.new_classes.includes("RateLimitActor"),
    )
  ) {
    throw new Error("Production requires the RateLimitActor Durable Object binding and migration");
  }
  if (config.vars?.MFA_REQUIRED !== "1") {
    throw new Error("Production must enforce MFA_REQUIRED=1");
  }
  const runtimeRoleStage = config.vars?.RUNTIME_ROLE_SPLIT_STAGE;
  if (typeof runtimeRoleStage !== "string" || !runtimeRoleStages.has(runtimeRoleStage)) {
    throw new Error("Production must declare RUNTIME_ROLE_SPLIT_STAGE as A, B or C");
  }
  if (requireFinalRuntimeSplit && runtimeRoleStage !== "C") {
    throw new Error("Production deploy requires runtime-role split stage C");
  }
  if (
    config.assets?.binding !== "ASSETS" ||
    config.assets?.not_found_handling !== "single-page-application" ||
    !Array.isArray(config.assets?.run_worker_first) ||
    !config.assets.run_worker_first.includes("/api/*")
  ) {
    throw new Error("Assets must provide SPA fallback and run the Worker first for /api/*");
  }
  const hyperdrive = config.hyperdrive;
  if (
    !Array.isArray(hyperdrive) ||
    hyperdrive.length !== requiredHyperdriveBindings.size ||
    new Set(hyperdrive.map((entry) => entry?.binding)).size !== requiredHyperdriveBindings.size ||
    hyperdrive.some(
      (entry) => !requiredHyperdriveBindings.has(entry?.binding) || !hyperdriveIdIsReal(entry?.id),
    )
  ) {
    throw new Error("Production requires real AUTH_HYPERDRIVE and APP_HYPERDRIVE bindings");
  }
  const hyperdriveIds = new Set(hyperdrive.map((entry) => entry.id.trim().toLowerCase()));
  if (runtimeRoleStage !== "A" && hyperdriveIds.size !== requiredHyperdriveBindings.size) {
    throw new Error("Runtime-role split stages B and C require distinct Hyperdrive IDs");
  }
  if (
    config.observability?.enabled !== true ||
    config.observability?.logs?.enabled !== true ||
    config.observability?.logs?.persist !== true ||
    config.observability?.logs?.invocation_logs !== false
  ) {
    throw new Error("Observability must retain structured logs without invocation logs");
  }
  if (requireBaseUrl) assertProductionBaseUrl(productionBaseUrlFor(config), config.name);
};

export const assertCleanWorktree = () => {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (status.trim()) throw new Error("Production release requires a clean git worktree");
};
