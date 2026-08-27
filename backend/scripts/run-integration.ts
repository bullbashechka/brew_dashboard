import { createIsolatedTestDatabase } from "./isolated-test-db.ts";
import { assertE2eAccountKind } from "./test-safety.ts";

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
assertE2eAccountKind(process.env.E2E_ACCOUNT_KIND);

const runTests = async (environment: Record<string, string | undefined>) => {
  const processResult = Bun.spawnSync(
    // The deterministic six-month fixture can take about a minute on a
    // constrained CI runner. Keep the per-test guard, but leave enough room
    // for the atomic rollback coverage to finish instead of masking it as a
    // flaky timeout.
    [process.execPath, "test", "--parallel=1", "--timeout=120000", "tests/integration"],
    {
      cwd: new URL("../", import.meta.url).pathname,
      env: { ...process.env, ...environment },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (processResult.exitCode !== 0) {
    throw new Error(`Integration tests failed with exit code ${processResult.exitCode ?? 1}`);
  }
};

if (!adminUrl) {
  throw new Error(
    "DATABASE_TEST_ADMIN_URL is required for integration tests and must point to a local PostgreSQL admin URL",
  );
}

const isolated = await createIsolatedTestDatabase(adminUrl);
try {
  await runTests({
    DATABASE_TEST_URL: isolated.databaseUrl,
    DATABASE_TEST_RUNTIME_URL: isolated.runtimeUrl,
    E2E_ACCOUNT_KIND: "e2e",
  });
} finally {
  await isolated.cleanup();
}
