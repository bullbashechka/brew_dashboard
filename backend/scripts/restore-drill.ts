import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { isLoopbackHostname } from "../src/security/hosts.ts";
import { createAccount } from "../src/admin/accounts.ts";
import { withRequestDatabase } from "../src/db/client.ts";
import { createChildEnvironment } from "./child-environment.ts";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));

const run = async (
  script: string,
  environment: Record<string, string>,
  argumentsList: string[] = [],
) => {
  const child = Bun.spawn([process.execPath, script, ...argumentsList], {
    cwd: backendDirectory,
    env: createChildEnvironment(process.env, environment),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${script} failed during the restore drill`);
};

/** Exercise dump -> authenticated decrypt -> clean restore -> role/RLS validation locally. */
export const runRestoreDrill = async (adminUrl: string, sourceDatabaseUrl: string) => {
  const admin = new URL(adminUrl);
  const source = new URL(sourceDatabaseUrl);
  if (!isLoopbackHostname(admin.hostname) || !isLoopbackHostname(source.hostname)) {
    throw new Error("The automated restore drill accepts loopback PostgreSQL only");
  }
  const targetDatabase = `brew_dashboard_restore_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(admin);
  target.pathname = `/${targetDatabase}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), "brew-dashboard-restore-drill-"));
  const key = randomBytes(32).toString("base64url");
  const keyId = `restore-drill-${randomUUID()}`;
  const adminClient = new Client({ connectionString: admin.toString() });
  await adminClient.connect();
  try {
    const sentinelLogin = `restore-sentinel-${randomUUID().slice(0, 8)}`;
    const sentinel = await withRequestDatabase(source.toString(), (db) =>
      createAccount(db, {
        login: sentinelLogin,
        password: "Restore-drill-sentinel-A1",
        accountKind: "e2e",
      }),
    );
    const sourceClient = new Client({ connectionString: source.toString() });
    await sourceClient.connect();
    try {
      await sourceClient.query(
        `INSERT INTO app.locations (network_id, name, name_normalized, sort_order)
         VALUES ($1, 'Restore sentinel', 'restore sentinel', 1)`,
        [sentinel.networkId],
      );
    } finally {
      await sourceClient.end();
    }
    await run("scripts/backup-dump.ts", {
      DATABASE_MIGRATION_URL: source.toString(),
      BACKUP_OUTPUT_DIR: directory,
      BACKUP_ENCRYPTION_KEY: key,
      BACKUP_ENCRYPTION_KEY_ID: keyId,
    });
    const entries = await readdir(directory);
    const artifact = entries.find((entry) => entry.endsWith(".dump.enc"));
    if (!artifact) throw new Error("Restore drill did not create an encrypted artifact");
    await adminClient.query(`CREATE DATABASE "${targetDatabase}"`);
    await run(
      "scripts/backup-restore.ts",
      {
        DATABASE_RESTORE_URL: target.toString(),
        BACKUP_ENCRYPTION_KEY: key,
        BACKUP_ENCRYPTION_KEY_ID: keyId,
      },
      [
        "--file",
        path.join(directory, artifact),
        "--manifest",
        path.join(directory, `${artifact}.manifest.json`),
        "--confirm-empty-target",
        targetDatabase,
      ],
    );

    const restored = new Client({ connectionString: target.toString() });
    await restored.connect();
    try {
      const result = await restored.query<{
        schema_present: boolean;
        migration_head: boolean;
        sentinel_present: boolean;
      }>(
        `SELECT to_regclass('app.app_users') IS NOT NULL AS schema_present,
          to_regclass('auth.two_factor') IS NOT NULL AS migration_head,
          EXISTS (
            SELECT 1 FROM app.app_users app_user
            JOIN auth.users auth_user ON auth_user.id = app_user.auth_user_id
            JOIN auth.accounts account ON account.user_id = auth_user.id
            JOIN app.locations location ON location.network_id = app_user.network_id
            WHERE app_user.auth_user_id = $1 AND app_user.network_id = $2
              AND app_user.login_normalized = $3
              AND account.provider_id = 'credential'
              AND location.name_normalized = 'restore sentinel'
          ) AS sentinel_present`,
        [sentinel.authUserId, sentinel.networkId, sentinel.login],
      );
      if (
        !result.rows[0]?.schema_present ||
        !result.rows[0]?.migration_head ||
        !result.rows[0]?.sentinel_present
      ) {
        throw new Error("Restore drill catalog verification failed");
      }
      await restored.query("BEGIN");
      try {
        await restored.query("SET LOCAL ROLE brew_app_runtime");
        await restored.query("SELECT set_config('app.network_id', $1, true)", [sentinel.networkId]);
        await restored.query("SELECT set_config('app.auth_user_id', $1, true)", [
          sentinel.authUserId,
        ]);
        const tenantProbe = await restored.query<{ own_rows: string; foreign_rows: string }>(
          `SELECT
             (SELECT count(*)::text FROM app.locations WHERE name_normalized = 'restore sentinel') AS own_rows,
             (SELECT count(*)::text FROM app.app_users WHERE auth_user_id <> $1) AS foreign_rows`,
          [sentinel.authUserId],
        );
        if (tenantProbe.rows[0]?.own_rows !== "1" || tenantProbe.rows[0]?.foreign_rows !== "0") {
          throw new Error("Restore drill tenant-isolation probe failed");
        }
      } finally {
        await restored.query("ROLLBACK");
      }
    } finally {
      await restored.end();
    }
  } finally {
    await adminClient
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [targetDatabase],
      )
      .catch(() => undefined);
    await adminClient.query(`DROP DATABASE IF EXISTS "${targetDatabase}"`).catch(() => undefined);
    await adminClient.end();
    await rm(directory, { recursive: true, force: true });
  }
};
