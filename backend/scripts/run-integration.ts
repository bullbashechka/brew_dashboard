import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));

const runTests = async (environment: Record<string, string | undefined>) => {
  const processResult = Bun.spawnSync(["bun", "test", "tests/integration"], {
    cwd: backendDirectory,
    env: { ...process.env, ...environment },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (processResult.exitCode !== 0) {
    throw new Error(`Integration tests failed with exit code ${processResult.exitCode ?? 1}`);
  }
};

if (!adminUrl) {
  throw new Error(
    "DATABASE_TEST_ADMIN_URL is required for integration tests and must point to a local PostgreSQL admin URL",
  );
}

const parsedAdminUrl = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedAdminUrl.hostname)) {
  throw new Error("DATABASE_TEST_ADMIN_URL must point to localhost or an equivalent loopback host");
}

const databaseName = `brew_dashboard_test_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

const adminClient = new Client({ connectionString: adminUrl });
await adminClient.connect();
try {
  const runtimeRole = await adminClient.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brew_runtime') AS exists",
  );
  if (runtimeRole.rows[0]?.exists) {
    throw new Error(
      "DATABASE_TEST_ADMIN_URL must use an isolated cluster without an existing brew_runtime role",
    );
  }
  await adminClient.query(`CREATE DATABASE "${databaseName}"`);
} finally {
  await adminClient.end();
}

try {
  const migrationProcess = Bun.spawnSync(["bun", "run", "db:migrate"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: databaseUrl.toString(),
      NODE_ENV: "test",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (migrationProcess.exitCode !== 0) {
    throw new Error(`Database migration failed with exit code ${migrationProcess.exitCode ?? 1}`);
  }
  await runTests({ DATABASE_TEST_URL: databaseUrl.toString() });
} finally {
  const cleanupClient = new Client({ connectionString: adminUrl });
  await cleanupClient.connect();
  try {
    await cleanupClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await cleanupClient.query("DROP ROLE IF EXISTS brew_runtime");
  } finally {
    await cleanupClient.end();
  }
}
