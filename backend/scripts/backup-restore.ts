import { spawn } from "node:child_process";
import { chmod, mkdtemp, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { decryptEncryptedBackupToFile, parseBackupEncryptionKey } from "./backup-crypto.ts";
import { readAndVerifyBackupManifest } from "./backup-manifest.ts";
import {
  databaseNameFor,
  isProductionDatabaseTarget,
  parsePostgresUrl,
  postgresChildEnvironment,
  postgresClientConfiguration,
} from "./postgres-cli.ts";
import { bootstrapRuntimeRoles } from "./runtime-role-policy.ts";

const parseArguments = () => {
  const values = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !["--file", "--manifest", "--confirm-empty-target"].includes(flag)) {
      throw new Error(`Unsupported restore argument: ${flag ?? "<missing>"}`);
    }
    if (!value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`${flag} requires one value and may be provided only once`);
    }
    values.set(flag, value);
  }
  for (const flag of ["--file", "--manifest", "--confirm-empty-target"]) {
    if (!values.has(flag)) throw new Error(`${flag} is required`);
  }
  const file = path.resolve(values.get("--file")!);
  const manifest = path.resolve(values.get("--manifest")!);
  if (!path.isAbsolute(values.get("--file")!) || !path.isAbsolute(values.get("--manifest")!)) {
    throw new Error("Backup and manifest paths must be absolute");
  }
  return { file, manifest, confirmation: values.get("--confirm-empty-target")! };
};

const assertEmptyTarget = async (client: Client, expectedDatabase: string) => {
  const identity = await client.query<{ database: string; user_tables: string }>(
    `SELECT current_database() AS database,
       (SELECT count(*)::text FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S')
          AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND namespace.nspname NOT LIKE 'pg_toast%') AS user_tables`,
  );
  if (identity.rows[0]?.database !== expectedDatabase) {
    throw new Error("Restore confirmation does not match the connected database");
  }
  if (identity.rows[0]?.user_tables !== "0") {
    throw new Error("Restore target must be an empty database");
  }
};

const runRestore = async (dumpPath: string, target: URL) => {
  const child = spawn(
    "pg_restore",
    [
      "--dbname",
      databaseNameFor(target),
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--single-transaction",
      dumpPath,
    ],
    { env: postgresChildEnvironment(target), stdio: ["ignore", "ignore", "inherit"] },
  );
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(`pg_restore failed with exit code ${code}`);
};

const assertPgDump = async (dumpPath: string) => {
  const handle = await open(dumpPath, "r");
  try {
    const signature = Buffer.alloc(5);
    const result = await handle.read(signature, 0, signature.length, 0);
    if (result.bytesRead !== 5 || signature.toString("ascii") !== "PGDMP") {
      throw new Error("Decrypted backup is not a PostgreSQL custom-format archive");
    }
  } finally {
    await handle.close();
  }
};

const main = async () => {
  const args = parseArguments();
  const target = parsePostgresUrl(process.env.DATABASE_RESTORE_URL, "DATABASE_RESTORE_URL");
  const databaseName = databaseNameFor(target);
  if (args.confirmation !== databaseName) {
    throw new Error("--confirm-empty-target must equal the target database name");
  }
  if (isProductionDatabaseTarget(target) && process.env.ALLOW_PRODUCTION_RESTORE !== "1") {
    throw new Error("Non-local restore requires ALLOW_PRODUCTION_RESTORE=1");
  }
  const key = parseBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const manifest = await readAndVerifyBackupManifest(args.manifest, args.file, key);
  const expectedKeyId = process.env.BACKUP_ENCRYPTION_KEY_ID;
  if (!expectedKeyId || manifest.keyId !== expectedKeyId) {
    throw new Error("Backup manifest key ID does not match BACKUP_ENCRYPTION_KEY_ID");
  }
  const clientConfiguration = await postgresClientConfiguration(target);
  const targetClient = new Client(clientConfiguration);
  await targetClient.connect();
  try {
    await assertEmptyTarget(targetClient, databaseName);
  } finally {
    await targetClient.end();
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "brew-dashboard-restore-"));
  await chmod(temporaryDirectory, 0o700);
  const dumpPath = path.join(temporaryDirectory, "restore.dump");
  let cleanupStarted = false;
  const cleanupPlaintext = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    await rm(temporaryDirectory, { recursive: true, force: true });
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      void cleanupPlaintext().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    await decryptEncryptedBackupToFile(args.file, dumpPath, key);
    const metadata = await stat(dumpPath);
    if (!metadata.isFile() || metadata.size <= 5) throw new Error("Decrypted backup is empty");
    await assertPgDump(dumpPath);
    await runRestore(dumpPath, target);
    const restoredClient = new Client(clientConfiguration);
    await restoredClient.connect();
    try {
      await bootstrapRuntimeRoles(restoredClient);
    } finally {
      await restoredClient.end();
    }
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    await cleanupPlaintext();
  }
  console.log(JSON.stringify({ event: "backup_restored.v1", database: databaseName }));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();

export const __test = { parseArguments, assertEmptyTarget, assertPgDump, runRestore };
