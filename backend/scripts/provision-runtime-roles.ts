import { Client } from "pg";
import { bootstrapRuntimeRoles } from "./runtime-role-policy.ts";
import {
  isProductionDatabaseTarget,
  parsePostgresUrl,
  postgresClientConfiguration,
} from "./postgres-cli.ts";

const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_PUBLIC_URL;
const authPassword = process.env.AUTH_RUNTIME_DATABASE_PASSWORD;
const appPassword = process.env.APP_RUNTIME_DATABASE_PASSWORD;
if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
if (!authPassword || authPassword.length < 24 || !appPassword || appPassword.length < 24) {
  throw new Error(
    "AUTH_RUNTIME_DATABASE_PASSWORD and APP_RUNTIME_DATABASE_PASSWORD must be at least 24 characters",
  );
}
const parsedDatabaseUrl = parsePostgresUrl(
  databaseUrl,
  "DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL",
);
if (
  isProductionDatabaseTarget(parsedDatabaseUrl) &&
  process.env.ALLOW_PRODUCTION_MIGRATIONS !== "1"
) {
  throw new Error("Non-local role provisioning requires ALLOW_PRODUCTION_MIGRATIONS=1");
}

const client = new Client(await postgresClientConfiguration(parsedDatabaseUrl));
await client.connect();
try {
  // Stage B provisions and validates the split roles while the legacy role remains available
  // for rollback. Stage C revocation is an explicit, separately gated operation.
  await bootstrapRuntimeRoles(client, { revokeLegacy: false });
  for (const [role, password] of [
    ["brew_auth_runtime", authPassword],
    ["brew_app_runtime", appPassword],
  ] as const) {
    const statement = await client.query<{ sql: string }>(
      "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
      [role, password],
    );
    await client.query(statement.rows[0]!.sql);
  }
} finally {
  await client.end();
}
