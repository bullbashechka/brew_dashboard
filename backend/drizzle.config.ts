import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_PUBLIC_URL ??
  "postgresql://localhost:5432/brew_dashboard";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: { url: databaseUrl },
});
