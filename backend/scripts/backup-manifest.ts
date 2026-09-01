import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { BACKUP_FORMAT } from "./backup-crypto.ts";

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  generatedAt: string;
  file: string;
  bytes: number;
  sha256: string;
  retentionDays: number;
  keyId: string;
  manifestMac: string;
};

type UnsignedBackupManifest = Omit<BackupManifest, "manifestMac">;

const sha256Pattern = /^[a-f0-9]{64}$/u;
const keyIdPattern = /^[A-Za-z0-9._:-]{1,64}$/u;

export const parseBackupManifest = (value: unknown): BackupManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backup manifest must be an object");
  }
  const candidate = value as Partial<BackupManifest>;
  const expectedKeys = [
    "bytes",
    "file",
    "format",
    "generatedAt",
    "keyId",
    "manifestMac",
    "retentionDays",
    "sha256",
  ];
  if (Object.keys(candidate).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("Backup manifest contains unsupported fields");
  }
  if (candidate.format !== BACKUP_FORMAT) throw new Error("Backup manifest format is unsupported");
  if (typeof candidate.file !== "string" || path.basename(candidate.file) !== candidate.file) {
    throw new Error("Backup manifest file name is invalid");
  }
  if (!Number.isSafeInteger(candidate.bytes) || candidate.bytes! <= 0) {
    throw new Error("Backup manifest byte count is invalid");
  }
  if (typeof candidate.sha256 !== "string" || !sha256Pattern.test(candidate.sha256)) {
    throw new Error("Backup manifest checksum is invalid");
  }
  if (
    typeof candidate.generatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.generatedAt)) ||
    !candidate.generatedAt.endsWith("Z")
  ) {
    throw new Error("Backup manifest timestamp is invalid");
  }
  if (
    !Number.isSafeInteger(candidate.retentionDays) ||
    candidate.retentionDays! < 1 ||
    candidate.retentionDays! > 3650
  ) {
    throw new Error("Backup manifest retention is invalid");
  }
  if (typeof candidate.keyId !== "string" || !keyIdPattern.test(candidate.keyId)) {
    throw new Error("Backup manifest key id is invalid");
  }
  if (typeof candidate.manifestMac !== "string" || !sha256Pattern.test(candidate.manifestMac)) {
    throw new Error("Backup manifest authentication code is invalid");
  }
  return candidate as BackupManifest;
};

const unsignedManifest = (manifest: UnsignedBackupManifest | BackupManifest) => ({
  format: manifest.format,
  generatedAt: manifest.generatedAt,
  file: manifest.file,
  bytes: manifest.bytes,
  sha256: manifest.sha256,
  retentionDays: manifest.retentionDays,
  keyId: manifest.keyId,
});

export const createBackupManifestMac = (
  manifest: UnsignedBackupManifest | BackupManifest,
  key: Buffer,
) =>
  createHmac("sha256", key)
    .update("brew-dashboard-backup-manifest-v1\0", "utf8")
    .update(JSON.stringify(unsignedManifest(manifest)), "utf8")
    .digest("hex");

const assertManifestAuthenticated = (manifest: BackupManifest, key: Buffer) => {
  const actual = Buffer.from(manifest.manifestMac, "hex");
  const expected = Buffer.from(createBackupManifestMac(manifest, key), "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Backup manifest authentication failed");
  }
};

const sha256File = async (filePath: string) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
};

export const readAndVerifyBackupManifest = async (
  manifestPath: string,
  artifactPath: string,
  key: Buffer,
) => {
  const manifest = parseBackupManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  assertManifestAuthenticated(manifest, key);
  if (manifest.file !== path.basename(artifactPath)) {
    throw new Error("Backup manifest does not describe the selected artifact");
  }
  const metadata = await stat(artifactPath);
  if (!metadata.isFile() || metadata.size !== manifest.bytes) {
    throw new Error("Backup artifact size does not match its manifest");
  }
  if ((await sha256File(artifactPath)) !== manifest.sha256) {
    throw new Error("Backup artifact checksum does not match its manifest");
  }
  return manifest;
};

export const __test = { parseBackupManifest, sha256File, unsignedManifest };
