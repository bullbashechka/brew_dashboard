import { fileURLToPath } from "node:url";

import { createAccount, deleteAccount } from "../src/admin/accounts.ts";
import { completeOnboarding, setOnboardingLanguage } from "../src/onboarding/service.ts";
import { withRequestDatabase } from "../src/db/client.ts";
import { createIsolatedTestDatabase } from "./isolated-test-db.ts";
import { SYSTEM_E2E_FIXTURES } from "../../scripts/system-e2e-fixture.ts";
import { assertE2eAccountKind } from "./test-safety.ts";

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
if (!adminUrl) {
  throw new Error(
    "DATABASE_TEST_ADMIN_URL is required for system E2E and must point to a local PostgreSQL admin URL",
  );
}
assertE2eAccountKind(process.env.E2E_ACCOUNT_KIND);

const webappDirectory = fileURLToPath(new URL("../../webapp/", import.meta.url));
const secondaryLogins = new Set<string>(
  Object.values(SYSTEM_E2E_FIXTURES).map((group) => group.secondary.login),
);
const workerEnvironment = { ...process.env };
for (const variable of [
  "DATABASE_TEST_ADMIN_URL",
  "DATABASE_TEST_URL",
  "DATABASE_TEST_RUNTIME_URL",
  "DATABASE_MIGRATION_URL",
  "DATABASE_PUBLIC_URL",
  "DATABASE_URL",
  "RUNTIME_DATABASE_PASSWORD",
  "PGPASSWORD",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CF_API_TOKEN",
]) {
  delete workerEnvironment[variable];
}
const isolated = await createIsolatedTestDatabase(adminUrl);
const accounts: Awaited<ReturnType<typeof createAccount>>[] = [];
let server: Bun.Subprocess | undefined;
let stopped = false;
const stop = async (exitCode?: number) => {
  if (stopped) return;
  stopped = true;
  server?.kill();
  await server?.exited.catch(() => undefined);
  for (const account of accounts) {
    await withRequestDatabase(isolated.databaseUrl, async (db) => {
      await deleteAccount(db, { login: account.login, accountKind: "e2e" });
    }).catch(() => undefined);
  }
  await isolated.cleanup();
  if (exitCode !== undefined) process.exitCode = exitCode;
};

process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(143));

try {
  for (const fixture of Object.values(SYSTEM_E2E_FIXTURES).flatMap((group) =>
    Object.values(group),
  )) {
    const account = await withRequestDatabase(isolated.databaseUrl, (db) =>
      createAccount(db, {
        login: fixture.login,
        password: fixture.password,
        accountKind: "e2e",
      }),
    );
    accounts.push(account);
    if (secondaryLogins.has(account.login)) {
      const startedAt = new Date();
      await withRequestDatabase(isolated.databaseUrl, (db) =>
        db.transaction(async (transaction) => {
          await setOnboardingLanguage(transaction, {
            authUserId: account.authUserId,
            networkId: account.networkId,
            language: "en",
            idempotencyKey: crypto.randomUUID(),
          });
          await completeOnboarding(transaction, {
            authUserId: account.authUserId,
            networkId: account.networkId,
            request: {
              networkName: "Stage 12 Isolation Lab",
              ownerName: "Stage 12 Isolation Owner",
              locations: [{ name: "Isolation" }],
              country: "KZ",
              currency: "KZT",
              timeZone: "Asia/Almaty",
              idempotencyKey: crypto.randomUUID(),
            },
            startedAt,
          });
        }),
      );
    }
  }

  const serverStdoutLog = Bun.file(
    new URL("../../.scratch/system-e2e-server.stdout.log", import.meta.url),
  );
  const serverStderrLog = Bun.file(
    new URL("../../.scratch/system-e2e-server.stderr.log", import.meta.url),
  );
  server = Bun.spawn(
    [
      process.execPath,
      "run",
      "dev",
      "--",
      "--mode",
      "system",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
    ],
    {
      cwd: webappDirectory,
      env: {
        ...workerEnvironment,
        E2E_SYSTEM: "1",
        E2E_ACCOUNT_KIND: "e2e",
        BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        BETTER_AUTH_URL: "http://127.0.0.1:4173",
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: isolated.runtimeUrl,
        WRANGLER_WRITE_LOGS: "false",
      },
      // Workerd starts children with inherited descriptors. Use durable local
      // files instead of Playwright's short-lived reporter pipes.
      stdout: serverStdoutLog,
      stderr: serverStderrLog,
    },
  );

  const exitCode = await server.exited;
  await stop(exitCode);
} catch (error) {
  await stop();
  throw error;
}
