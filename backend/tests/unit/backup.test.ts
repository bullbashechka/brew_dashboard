import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BACKUP_MAGIC,
  createBackupCipher,
  decryptEncryptedBackupToFile,
  parseBackupEncryptionKey,
  verifyEncryptedBackup,
} from "../../scripts/backup-crypto.ts";
import { __test as backupDumpTest } from "../../scripts/backup-dump.ts";
import {
  createBackupManifestMac,
  parseBackupManifest,
  readAndVerifyBackupManifest,
} from "../../scripts/backup-manifest.ts";
import { postgresChildEnvironment } from "../../scripts/postgres-cli.ts";

describe("encrypted backup artifacts", () => {
  test("round-trips a custom dump and authenticates tampering", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "brew-backup-test-"));
    try {
      const key = randomBytes(32);
      const { cipher, nonce } = createBackupCipher(key);
      const plaintext = Buffer.from("isolated backup payload\n", "utf8");
      const encrypted = Buffer.concat([
        BACKUP_MAGIC,
        nonce,
        cipher.update(plaintext),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      const filePath = path.join(directory, "backup.dump.enc");
      await writeFile(filePath, encrypted, { mode: 0o600 });
      const result = await verifyEncryptedBackup(filePath, key);
      expect(result.format).toBe("aes-256-gcm+pg_dump-custom");
      expect(result.plaintextBytes).toBe(plaintext.length);
      expect(result.bytes).toBe(encrypted.length);

      const decryptedPath = path.join(directory, "restore.dump");
      const decrypted = await decryptEncryptedBackupToFile(filePath, decryptedPath, key);
      expect(decrypted.mode & 0o777).toBe(0o600);
      expect(await readFile(decryptedPath)).toEqual(plaintext);

      const tampered = Buffer.from(await readFile(filePath));
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
      await writeFile(filePath, tampered);
      await expect(verifyEncryptedBackup(filePath, key)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires an exact 32-byte base64url key and a dedicated output directory", () => {
    const key = randomBytes(32).toString("base64url");
    expect(parseBackupEncryptionKey(key)).toHaveLength(32);
    expect(() => parseBackupEncryptionKey("too-short")).toThrow();
    expect(() => backupDumpTest.assertSafeOutputDirectory("/")).toThrow();
    expect(() => backupDumpTest.assertSafeOutputDirectory(process.cwd())).toThrow();
    expect(() =>
      backupDumpTest.assertSafeOutputDirectory(path.join(os.homedir(), "backups")),
    ).toThrow();
    expect(backupDumpTest.positiveRetentionDays(undefined)).toBe(30);
    expect(() => backupDumpTest.positiveRetentionDays("0")).toThrow();
  });

  test("validates strict manifests before restore and detects artifact changes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "brew-manifest-test-"));
    try {
      const artifactPath = path.join(directory, "backup.dump.enc");
      const key = randomBytes(32);
      const bytes = Buffer.from("encrypted-artifact", "utf8");
      await writeFile(artifactPath, bytes, { mode: 0o600 });
      const unsignedManifest = {
        format: "aes-256-gcm+pg_dump-custom" as const,
        generatedAt: "2026-08-31T00:00:00.000Z",
        file: path.basename(artifactPath),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        retentionDays: 30,
        keyId: "backup-key-v1",
      };
      const manifest = {
        ...unsignedManifest,
        manifestMac: createBackupManifestMac(unsignedManifest, key),
      };
      const manifestPath = `${artifactPath}.manifest.json`;
      await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
      await expect(readAndVerifyBackupManifest(manifestPath, artifactPath, key)).resolves.toEqual(
        manifest,
      );
      expect(() => parseBackupManifest({ ...manifest, unexpected: true })).toThrow();
      await writeFile(artifactPath, Buffer.from("changed-artifact", "utf8"));
      await expect(readAndVerifyBackupManifest(manifestPath, artifactPath, key)).rejects.toThrow();
      const renamedRollback = {
        ...manifest,
        file: "fresh-name.dump.enc",
        generatedAt: "2026-08-31T01:00:00.000Z",
      };
      expect(() =>
        parseBackupManifest({
          ...renamedRollback,
          manifestMac: createHash("sha256").update("attacker-controlled").digest("hex"),
        }),
      ).not.toThrow();
      const forgedPath = path.join(directory, renamedRollback.file);
      await writeFile(forgedPath, bytes, { mode: 0o600 });
      const forgedManifestPath = `${forgedPath}.manifest.json`;
      await writeFile(forgedManifestPath, JSON.stringify(renamedRollback), { mode: 0o600 });
      await expect(
        readAndVerifyBackupManifest(forgedManifestPath, forgedPath, key),
      ).rejects.toThrow("authentication failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a backup destination that resolves through a symbolic link", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "brew-backup-path-test-"));
    try {
      const link = path.join(directory, "linked-output");
      await symlink(os.tmpdir(), link, "dir");
      await expect(
        backupDumpTest.assertSafeResolvedOutputDirectory(link, await realpath(link)),
      ).rejects.toThrow("symbolic links");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires verify-full and a root CA for remote PostgreSQL children", () => {
    expect(() =>
      postgresChildEnvironment(
        new URL("postgresql://user:password@db.example/brew?sslmode=require"),
      ),
    ).toThrow("sslmode=verify-full");
    expect(() =>
      postgresChildEnvironment(
        new URL("postgresql://user:password@db.example/brew?sslmode=verify-full"),
        {},
      ),
    ).toThrow("sslrootcert");
    const remote = postgresChildEnvironment(
      new URL(
        "postgresql://user:password@db.example/brew?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem&application_name=restore",
      ),
      { PATH: "/usr/bin", UNKNOWN_TOKEN: "must-not-cross-boundary" },
    );
    expect(remote.PGDATABASE).toBe("brew");
    expect(remote.PGSSLMODE).toBe("verify-full");
    expect(remote.PGAPPNAME).toBe("restore");
    expect(remote.UNKNOWN_TOKEN).toBeUndefined();
    expect(postgresChildEnvironment(new URL("postgresql://localhost/brew"), {})).toMatchObject({
      PGHOST: "localhost",
      PGDATABASE: "brew",
    });
  });
});
