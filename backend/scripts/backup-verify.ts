import { stat } from "node:fs/promises";
import path from "node:path";

import { parseBackupEncryptionKey, verifyEncryptedBackup } from "./backup-crypto.ts";

const fileArgument = () => {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length !== 2 || argumentsList[0] !== "--file" || !argumentsList[1]) {
    throw new Error("Usage: bun scripts/backup-verify.ts --file /absolute/path/to/backup.dump.enc");
  }
  const filePath = argumentsList[1];
  if (!path.isAbsolute(filePath)) throw new Error("Backup file path must be absolute");
  return path.resolve(filePath);
};

const filePath = fileArgument();
const metadata = await stat(filePath);
if (!metadata.isFile()) throw new Error("Backup file must be a regular file");
const result = await verifyEncryptedBackup(
  filePath,
  parseBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY),
);
console.log(
  JSON.stringify({
    event: "backup_verified.v1",
    file: path.basename(filePath),
    bytes: result.bytes,
    plaintextBytes: result.plaintextBytes,
    sha256: result.sha256,
    format: result.format,
  }),
);
