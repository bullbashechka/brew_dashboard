import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createChildEnvironment } from "./child-environment.ts";
import { createIsolatedTestDatabase } from "./isolated-test-db.ts";
import { runRestoreDrill } from "./restore-drill.ts";
import { assertE2eAccountKind } from "./test-safety.ts";

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
const requestedTarget = process.env.INTEGRATION_TEST_TARGET;
if (requestedTarget && !/^tests\/integration\/[a-z0-9.-]+\.test\.ts$/u.test(requestedTarget)) {
  throw new Error("INTEGRATION_TEST_TARGET must select one integration test file");
}
assertE2eAccountKind(process.env.E2E_ACCOUNT_KIND);

if (!adminUrl) {
  throw new Error(
    "DATABASE_TEST_ADMIN_URL is required for integration tests and must point to a local PostgreSQL admin URL",
  );
}

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const integrationDirectory = fileURLToPath(new URL("../tests/integration/", import.meta.url));
const targets = requestedTarget
  ? [requestedTarget]
  : (await readdir(integrationDirectory))
      .filter((name) => name.endsWith(".integration.test.ts"))
      .sort()
      .map((name) => `tests/integration/${name}`);
if (!targets.length) throw new Error("No integration test files were found");

const runTests = (target: string, environment: Record<string, string>) => {
  const processResult = Bun.spawnSync(
    [process.execPath, "test", "--parallel=1", "--timeout=120000", target],
    {
      cwd: backendDirectory,
      env: createChildEnvironment(process.env, environment),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (processResult.exitCode !== 0) {
    throw new Error(`${target} failed with exit code ${processResult.exitCode ?? 1}`);
  }
};

// Each suite receives a fresh database. This bounds PostgreSQL/WAL disk use and prevents a heavy
// deterministic fixture from corrupting the evidence produced by later security suites.
for (const [index, target] of targets.entries()) {
  const isolated = await createIsolatedTestDatabase(adminUrl, {
    enableSplitRuntimeLogins: target.endsWith("/mfa.integration.test.ts"),
  });
  try {
    runTests(target, {
      DATABASE_TEST_URL: isolated.databaseUrl,
      DATABASE_TEST_RUNTIME_URL: isolated.runtimeUrl,
      DATABASE_TEST_AUTH_RUNTIME_URL: isolated.authRuntimeUrl,
      DATABASE_TEST_APP_RUNTIME_URL: isolated.appRuntimeUrl,
      E2E_ACCOUNT_KIND: "e2e",
    });
    if (index === targets.length - 1) {
      await runRestoreDrill(adminUrl, isolated.databaseUrl);
    }
  } finally {
    await isolated.cleanup();
  }
}
