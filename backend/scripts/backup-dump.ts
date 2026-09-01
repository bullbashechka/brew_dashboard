import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  BACKUP_FORMAT,
  BACKUP_MAGIC,
  createBackupCipher,
  parseBackupEncryptionKey,
} from "./backup-crypto.ts";
import { isProductionDatabaseTarget, postgresChildEnvironment } from "./postgres-cli.ts";
import { createBackupManifestMac } from "./backup-manifest.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactPattern = /^brew-dashboard-\d{8}T\d{6}Z-[a-f0-9]{16}\.dump\.enc$/u;
const manifestSuffix = ".manifest.json";

const parseArguments = () => {
  const values = new Map<string, string | true>();
  const argumentsList = process.argv.slice(2);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (flag === "--prune") {
      if (values.has(flag)) throw new Error("--prune may be provided only once");
      values.set(flag, true);
      continue;
    }
    if (flag !== "--confirm-production" && flag !== "--retention-days") {
      throw new Error(`Unsupported argument: ${flag ?? "<missing>"}`);
    }
    if (values.has(flag)) throw new Error(`Repeated argument: ${flag}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  return values;
};

const positiveRetentionDays = (value: string | true | undefined) => {
  const days = Number(value ?? 30);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error("Retention must be an integer between 1 and 3650 days");
  }
  return days;
};

const assertSafeOutputDirectory = (value: string | undefined) => {
  if (!value || !path.isAbsolute(value)) {
    throw new Error("BACKUP_OUTPUT_DIR must be an absolute dedicated directory");
  }
  const resolved = path.resolve(value);
  const home = os.homedir();
  if (
    resolved === path.parse(resolved).root ||
    resolved === home ||
    resolved.startsWith(`${home}${path.sep}`) ||
    resolved === repositoryRoot ||
    resolved.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    throw new Error("BACKUP_OUTPUT_DIR must not be the filesystem root, home, or repository");
  }
  return resolved;
};

const assertSafeResolvedOutputDirectory = async (requested: string, resolved: string) => {
  // Canonicalise the parent first. macOS maps /var to /private/var without a user-controlled
  // symlink; comparing this physical expectation still rejects a symlink in the requested path.
  const physicalRequested = path.join(
    await realpath(path.dirname(requested)),
    path.basename(requested),
  );
  if (physicalRequested !== resolved) {
    throw new Error("BACKUP_OUTPUT_DIR must not contain symbolic links");
  }
  const metadata = await stat(resolved);
  if (!metadata.isDirectory()) throw new Error("BACKUP_OUTPUT_DIR must be a directory");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("BACKUP_OUTPUT_DIR must be owned by the current operating-system user");
  }
  if ((metadata.mode & 0o022) !== 0) {
    throw new Error("BACKUP_OUTPUT_DIR must not be group- or world-writable");
  }
};

const assertDatabaseAccess = (value: string | undefined, confirmation: string | undefined) => {
  if (!value) throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Backup database URL must use PostgreSQL");
  }
  if (isProductionDatabaseTarget(url)) {
    if (process.env.ALLOW_PRODUCTION_BACKUP !== "1" || confirmation !== "production") {
      throw new Error(
        "Non-local backups require ALLOW_PRODUCTION_BACKUP=1 and --confirm-production production",
      );
    }
  }
  return url;
};

const childEnvironmentFor = (url: URL) => postgresChildEnvironment(url);

const utcStamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");

const runDump = async (databaseUrl: URL, outputPath: string, key: Buffer) => {
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  const { cipher, nonce } = createBackupCipher(key);
  const digest = createHash("sha256");
  let bytes = 0;
  const digestTransform = new Transform({
    transform(chunk, _encoding, callback) {
      const value = Buffer.from(chunk as Buffer);
      digest.update(value);
      bytes += value.length;
      callback(null, value);
    },
  });
  const encryptedDump = spawn(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--compress=9"],
    { env: childEnvironmentFor(databaseUrl), stdio: ["ignore", "pipe", "pipe"] },
  );
  encryptedDump.stderr?.resume();
  const exit = new Promise<number>((resolve, reject) => {
    encryptedDump.once("error", reject);
    encryptedDump.once("close", (code) => resolve(code ?? 1));
  });

  try {
    const output = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    const header = Buffer.concat([BACKUP_MAGIC, nonce]);
    output.write(header);
    digest.update(header);
    bytes += header.length;
    await Promise.all([
      pipeline(encryptedDump.stdout!, cipher, digestTransform, output),
      exit,
    ]).then(([, code]) => {
      if (code !== 0) throw new Error(`pg_dump failed with exit code ${code}`);
    });
    const tag = cipher.getAuthTag();
    digest.update(tag);
    bytes += tag.length;
    await writeFile(temporaryPath, tag, { flag: "a", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    return { bytes, sha256: digest.digest("hex"), nonce: nonce.toString("base64url") };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const pruneBackups = async (directory: string, retentionDays: number) => {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !artifactPattern.test(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const metadata = await stat(fullPath);
    if (metadata.mtimeMs >= cutoff) continue;
    await rm(fullPath);
    const manifestPath = `${fullPath}${manifestSuffix}`;
    await rm(manifestPath, { force: true });
    removed.push(entry.name);
  }
  return removed;
};

const main = async () => {
  const args = parseArguments();
  const productionConfirmation = args.get("--confirm-production");
  const retentionArgument = args.get("--retention-days");
  const databaseUrl = assertDatabaseAccess(
    process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_PUBLIC_URL,
    typeof productionConfirmation === "string" ? productionConfirmation : undefined,
  );
  const requestedOutputDirectory = assertSafeOutputDirectory(process.env.BACKUP_OUTPUT_DIR);
  const retentionDays = positiveRetentionDays(retentionArgument);
  const encryptionKey = parseBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const keyId = process.env.BACKUP_ENCRYPTION_KEY_ID ?? "unspecified";
  if (!/^[A-Za-z0-9._:-]{1,64}$/u.test(keyId)) {
    throw new Error("BACKUP_ENCRYPTION_KEY_ID must be 1-64 safe identifier characters");
  }
  await mkdir(requestedOutputDirectory, { recursive: true, mode: 0o700 });
  const outputDirectory = assertSafeOutputDirectory(await realpath(requestedOutputDirectory));
  await assertSafeResolvedOutputDirectory(requestedOutputDirectory, outputDirectory);
  await chmod(outputDirectory, 0o700);

  const fileName = `brew-dashboard-${utcStamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}.dump.enc`;
  const outputPath = path.join(outputDirectory, fileName);
  const result = await runDump(databaseUrl, outputPath, encryptionKey);
  const generatedAt = new Date().toISOString();
  const unsignedManifest = {
    format: BACKUP_FORMAT,
    generatedAt,
    file: fileName,
    bytes: result.bytes,
    sha256: result.sha256,
    retentionDays,
    keyId,
  } as const;
  const manifest = {
    ...unsignedManifest,
    manifestMac: createBackupManifestMac(unsignedManifest, encryptionKey),
  };
  const manifestPath = `${outputPath}${manifestSuffix}`;
  const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporaryManifestPath, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporaryManifestPath, manifestPath);

  const removed = args.get("--prune") ? await pruneBackups(outputDirectory, retentionDays) : [];
  console.log(
    JSON.stringify({
      event: "backup_created.v1",
      file: fileName,
      manifest: path.basename(manifestPath),
      bytes: result.bytes,
      sha256: result.sha256,
      generatedAt,
      pruned: removed.length,
    }),
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export const __test = {
  artifactPattern,
  assertSafeOutputDirectory,
  positiveRetentionDays,
  childEnvironmentFor,
  assertSafeResolvedOutputDirectory,
};
