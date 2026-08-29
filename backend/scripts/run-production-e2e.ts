import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";

import { appUsers } from "../src/db/schema.ts";
import {
  parseAdminArguments,
  readAdminDatabaseUrl,
  readInteractivePassword,
  requireProductionAdmin,
  withAdminDatabase,
} from "./admin-common.ts";
import { parseProductionBaseUrl, parseProductionE2eLogin } from "./production-e2e-guard.ts";

const argumentsMap = parseAdminArguments(["--login", "--confirm-production"]);
const databaseUrl = readAdminDatabaseUrl();
requireProductionAdmin(databaseUrl, argumentsMap.get("--confirm-production"));
const login = parseProductionE2eLogin(argumentsMap.get("--login"));
const baseUrl = parseProductionBaseUrl(process.env.PRODUCTION_E2E_BASE_URL);
const password = await readInteractivePassword();

const account = await withAdminDatabase(async (db) => {
  const rows = await db
    .select({ accountKind: appUsers.accountKind, status: appUsers.status })
    .from(appUsers)
    .where(eq(appUsers.loginNormalized, login))
    .limit(1);
  return rows[0] ?? null;
});
if (!account || account.accountKind !== "e2e" || account.status !== "active") {
  throw new Error(
    "The explicitly selected production acceptance account must be an active e2e account",
  );
}

const webappDirectory = fileURLToPath(new URL("../../webapp/", import.meta.url));
const childEnvironment = { ...process.env };
for (const name of [
  "DATABASE_MIGRATION_URL",
  "DATABASE_PUBLIC_URL",
  "DATABASE_URL",
  "PGPASSWORD",
  "RUNTIME_DATABASE_PASSWORD",
  "BETTER_AUTH_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CF_API_TOKEN",
]) {
  delete childEnvironment[name];
}
childEnvironment.E2E_PRODUCTION = "1";
childEnvironment.E2E_PRODUCTION_BASE_URL = baseUrl;
childEnvironment.E2E_PRODUCTION_LOGIN = login;
childEnvironment.E2E_PRODUCTION_PASSWORD = password;

try {
  const abortController = new AbortController();
  const child = Bun.spawn([process.execPath, "run", "test:e2e:production"], {
    cwd: webappDirectory,
    env: childEnvironment,
    stderr: "inherit",
    stdout: "inherit",
    signal: abortController.signal,
  });
  const timeout = setTimeout(() => abortController.abort(), 900_000);
  await child.exited;
  clearTimeout(timeout);

  if (abortController.signal.aborted) {
    console.error("Production acceptance timed out after 15 minutes; child process aborted.");
    process.exitCode = 1;
  } else if (child.exitCode !== 0) {
    process.exitCode = child.exitCode ?? 1;
  }
} finally {
  childEnvironment.E2E_PRODUCTION_PASSWORD = "";
}
