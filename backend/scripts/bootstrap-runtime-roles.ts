import { Client } from "pg";

import { isLoopbackHostname } from "../src/security/hosts.ts";
import { parsePostgresUrl, postgresClientConfiguration } from "./postgres-cli.ts";
import { bootstrapRuntimeRoles } from "./runtime-role-policy.ts";

const databaseUrl = parsePostgresUrl(
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_PUBLIC_URL,
  "DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL",
);
if (!isLoopbackHostname(databaseUrl.hostname) && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "1") {
  throw new Error("Non-local runtime-role bootstrap requires ALLOW_PRODUCTION_MIGRATIONS=1");
}

const client = new Client(await postgresClientConfiguration(databaseUrl));
await client.connect();
try {
  await bootstrapRuntimeRoles(client);
} finally {
  await client.end();
}
console.log(JSON.stringify({ event: "runtime_roles_bootstrapped.v1" }));
