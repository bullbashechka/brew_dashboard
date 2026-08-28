import { cleanupExpiredSecurityData } from "../src/admin/retention.ts";
import {
  parseAdminArguments,
  readAdminDatabaseUrl,
  requireProductionAdmin,
  withAdminDatabase,
} from "./admin-common.ts";

const argumentsMap = parseAdminArguments(["--execute", "--confirm-production"], ["--execute"]);
const databaseUrl = readAdminDatabaseUrl();
requireProductionAdmin(databaseUrl, argumentsMap.get("--confirm-production"));

const report = await withAdminDatabase((db) =>
  cleanupExpiredSecurityData(db, { dryRun: !argumentsMap.has("--execute") }),
);

console.log(JSON.stringify({ event: "expired_security_data_cleanup.v1", ...report }));
