import { Client } from "pg";

import {
  isProductionDatabaseTarget,
  parsePostgresUrl,
  postgresClientConfiguration,
} from "./postgres-cli.ts";

const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_PUBLIC_URL;
const confirmation = process.argv.slice(2);
if (
  confirmation.length !== 2 ||
  confirmation[0] !== "--confirm-production" ||
  confirmation[1] !== "production"
) {
  throw new Error("Usage: bun scripts/revoke-legacy-runtime.ts --confirm-production production");
}
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
const targetUrl = new URL(databaseUrl);
if (isProductionDatabaseTarget(targetUrl) && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "1") {
  throw new Error("Legacy role revocation requires ALLOW_PRODUCTION_MIGRATIONS=1");
}

const client = new Client(
  await postgresClientConfiguration(parsePostgresUrl(databaseUrl, "migration database URL")),
);
await client.connect();
try {
  await client.query(
    "ALTER ROLE brew_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS",
  );
  await client.query("REVOKE ALL ON ALL TABLES IN SCHEMA app, auth FROM brew_runtime");
  await client.query("REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth FROM brew_runtime");
  await client.query("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, auth FROM brew_runtime");
  await client.query("REVOKE ALL ON SCHEMA app, auth FROM brew_runtime");
} finally {
  await client.end();
}

console.log(JSON.stringify({ event: "legacy_runtime_revoked.v1", role: "brew_runtime" }));
