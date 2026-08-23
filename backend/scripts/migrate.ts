import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const databaseUrl = migrationUrl ?? process.env.DATABASE_PUBLIC_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
}

const hostname = new URL(databaseUrl).hostname;
const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
if (!isLoopback && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "1") {
  throw new Error(
    "Non-local migrations require ALLOW_PRODUCTION_MIGRATIONS=1; use a loopback DATABASE_MIGRATION_URL for local databases",
  );
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
} finally {
  await client.end();
}
