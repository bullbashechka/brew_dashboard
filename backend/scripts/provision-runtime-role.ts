import { Client } from "pg";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const databaseUrl = migrationUrl ?? process.env.DATABASE_PUBLIC_URL;
const runtimePassword = process.env.RUNTIME_DATABASE_PASSWORD;

if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
}
if (!runtimePassword || runtimePassword.length < 24) {
  throw new Error("RUNTIME_DATABASE_PASSWORD must be at least 24 characters");
}
const hostname = new URL(databaseUrl).hostname;
const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
if (!isLoopback && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "1") {
  throw new Error(
    "Non-local role provisioning requires ALLOW_PRODUCTION_MIGRATIONS=1; use a loopback DATABASE_MIGRATION_URL for local databases",
  );
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const role = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brew_runtime') AS exists",
  );
  if (!role.rows[0]?.exists) {
    throw new Error("brew_runtime does not exist; apply database migrations first");
  }

  // PostgreSQL parameters cannot be used directly in ALTER ROLE. quote_literal keeps the
  // secret out of logs and makes embedded quotes safe before the generated statement runs.
  const statement = await client.query<{ sql: string }>(
    "SELECT format('ALTER ROLE brew_runtime LOGIN PASSWORD %L', $1::text) AS sql",
    [runtimePassword],
  );
  await client.query(statement.rows[0]!.sql);
} finally {
  await client.end();
}
