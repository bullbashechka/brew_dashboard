import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  isProductionDatabaseTarget,
  parsePostgresUrl,
  postgresClientConfiguration,
} from "./postgres-cli.ts";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const databaseUrl = migrationUrl ?? process.env.DATABASE_PUBLIC_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
}

const targetUrl = new URL(databaseUrl);
if (isProductionDatabaseTarget(targetUrl) && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "1") {
  throw new Error(
    "Non-local migrations require ALLOW_PRODUCTION_MIGRATIONS=1; use a loopback DATABASE_MIGRATION_URL for local databases",
  );
}

const client = new Client(
  await postgresClientConfiguration(parsePostgresUrl(databaseUrl, "migration database URL")),
);
await client.connect();

try {
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
} finally {
  await client.end();
}
