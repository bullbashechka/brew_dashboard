import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { isLoopbackHostname } from "../src/security/hosts.ts";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));

export type IsolatedTestDatabase = {
  databaseName: string;
  databaseUrl: string;
  runtimeUrl: string;
  cleanup: () => Promise<void>;
};

const assertLoopback = (adminUrl: string) => {
  const parsed = new URL(adminUrl);
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      "DATABASE_TEST_ADMIN_URL must point to localhost or an equivalent loopback host",
    );
  }
};

/** Create a disposable database and least-privilege runtime role for tests. */
export const createIsolatedTestDatabase = async (
  adminUrl: string,
): Promise<IsolatedTestDatabase> => {
  assertLoopback(adminUrl);
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

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    const cleanupClient = new Client({ connectionString: adminUrl });
    await cleanupClient.connect();
    try {
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await cleanupClient.query("DROP ROLE IF EXISTS brew_runtime");
    } finally {
      await cleanupClient.end();
    }
  };

  try {
    const migrationProcess = Bun.spawnSync([process.execPath, "run", "db:migrate"], {
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

    const runtimePassword = randomBytes(24).toString("base64url");
    const databaseClient = new Client({ connectionString: databaseUrl.toString() });
    await databaseClient.connect();
    try {
      const statement = await databaseClient.query<{ sql: string }>(
        "SELECT format('ALTER ROLE brew_runtime LOGIN PASSWORD %L', $1::text) AS sql",
        [runtimePassword],
      );
      await databaseClient.query(statement.rows[0]!.sql);
    } finally {
      await databaseClient.end();
    }
    const runtimeUrl = new URL(databaseUrl);
    runtimeUrl.username = "brew_runtime";
    runtimeUrl.password = runtimePassword;
    return {
      databaseName,
      databaseUrl: databaseUrl.toString(),
      runtimeUrl: runtimeUrl.toString(),
      cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
};

export const __test = { assertLoopback };
