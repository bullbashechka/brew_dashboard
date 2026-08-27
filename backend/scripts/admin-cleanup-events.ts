import {
  cleanupProductEvents,
  PRODUCT_EVENTS_MAX_ROWS_PER_RUN,
  PRODUCT_EVENTS_RETENTION_DAYS,
} from "../src/events/retention.ts";
import {
  parseAdminArguments,
  readAdminDatabaseUrl,
  requireProductionAdmin,
  withAdminDatabase,
} from "./admin-common.ts";

const argumentsMap = parseAdminArguments(
  ["--days", "--batch-size", "--max-rows", "--execute", "--confirm-production"],
  ["--execute"],
);
const databaseUrl = readAdminDatabaseUrl();
requireProductionAdmin(databaseUrl, argumentsMap.get("--confirm-production"));

const parsePositiveInteger = (flag: string, fallback: number, max: number) => {
  const value = argumentsMap.get(flag);
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${flag} must be between 1 and ${max}`);
  }
  return parsed;
};

const dryRun = !argumentsMap.has("--execute");
const report = await withAdminDatabase((db) =>
  cleanupProductEvents(db, {
    retentionDays: parsePositiveInteger("--days", PRODUCT_EVENTS_RETENTION_DAYS, 3650),
    batchSize: parsePositiveInteger("--batch-size", 500, 500),
    maxRows: parsePositiveInteger(
      "--max-rows",
      PRODUCT_EVENTS_MAX_ROWS_PER_RUN,
      PRODUCT_EVENTS_MAX_ROWS_PER_RUN,
    ),
    dryRun,
  }),
);

console.log(
  JSON.stringify({
    event: "product_events_retention.v1",
    ...report,
  }),
);
