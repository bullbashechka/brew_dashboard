import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const placeholderHyperdriveIds = new Set(["", "<HYPERDRIVE_ID>", "your-hyperdrive-id"]);

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
    !url.hostname.startsWith(`${workerName}.`) ||
    !url.hostname.endsWith(".workers.dev")
  ) {
    throw new Error("BETTER_AUTH_URL must be the exact HTTPS workers.dev origin for this Worker");
  }
  return url.origin;
};

export const assertReleaseConfig = (config, { requireBaseUrl = true } = {}) => {
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
    hyperdrive.length !== 1 ||
    hyperdrive[0]?.binding !== "HYPERDRIVE" ||
    typeof hyperdrive[0]?.id !== "string" ||
    placeholderHyperdriveIds.has(hyperdrive[0].id)
  ) {
    throw new Error("Production requires exactly one real HYPERDRIVE binding");
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
