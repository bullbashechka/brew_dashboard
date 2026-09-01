import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const BACKUP_MAGIC = Buffer.from("BDBK1", "ascii");
export const BACKUP_NONCE_BYTES = 12;
export const BACKUP_TAG_BYTES = 16;
export const BACKUP_KEY_BYTES = 32;
export const BACKUP_FORMAT = "aes-256-gcm+pg_dump-custom";

export const parseBackupEncryptionKey = (value: string | undefined) => {
  if (!value) throw new Error("BACKUP_ENCRYPTION_KEY is required");
  const key = Buffer.from(value, "base64url");
  if (key.length !== BACKUP_KEY_BYTES) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a 32-byte base64url value");
  }
  return key;
};

export const createBackupCipher = (key: Buffer, nonce = randomBytes(BACKUP_NONCE_BYTES)) => {
  if (key.length !== BACKUP_KEY_BYTES) throw new Error("Backup key must be 32 bytes");
  if (nonce.length !== BACKUP_NONCE_BYTES) throw new Error("Backup nonce must be 12 bytes");
  return {
    nonce,
    cipher: createCipheriv("aes-256-gcm", key, nonce),
  };
};

const readHeader = async (filePath: string) => {
  const file = await stat(filePath);
  const minimumSize = BACKUP_MAGIC.length + BACKUP_NONCE_BYTES + BACKUP_TAG_BYTES;
  if (!file.isFile() || file.size < minimumSize) throw new Error("Backup artifact is truncated");
  const headerSize = BACKUP_MAGIC.length + BACKUP_NONCE_BYTES;
  const header = Buffer.alloc(headerSize);
  const stream = createReadStream(filePath, { start: 0, end: headerSize - 1 });
  let offset = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk as Buffer);
    bytes.copy(header, offset);
    offset += bytes.length;
  }
  if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error("Backup artifact format is not recognized");
  }
  return { file, nonce: header.subarray(BACKUP_MAGIC.length), headerSize };
};

/** Verify the GCM tag and hash an encrypted backup without materializing the dump. */
export const verifyEncryptedBackup = async (filePath: string, key: Buffer) => {
  const { file, nonce, headerSize } = await readHeader(filePath);
  if (file.size <= headerSize + BACKUP_TAG_BYTES) {
    throw new Error("Backup artifact contains no encrypted dump");
  }
  const ciphertextEnd = file.size - BACKUP_TAG_BYTES - 1;
  const tagStream = createReadStream(filePath, {
    start: file.size - BACKUP_TAG_BYTES,
    end: file.size - 1,
  });
  const tagChunks: Buffer[] = [];
  for await (const chunk of tagStream) tagChunks.push(Buffer.from(chunk as Buffer));
  const tag = Buffer.concat(tagChunks);
  if (tag.length !== BACKUP_TAG_BYTES) throw new Error("Backup authentication tag is truncated");

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const digest = createHash("sha256");
  let plaintextBytes = 0;
  const sink = new Transform({
    transform(chunk, _encoding, callback) {
      plaintextBytes += Buffer.byteLength(chunk);
      callback();
    },
  });
  const encrypted = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  const ciphertext = createReadStream(filePath, { start: headerSize, end: ciphertextEnd });
  await pipeline(ciphertext, decipher, sink);
  // Hashing is intentionally a separate pass over the encrypted bytes so verification does not
  // expose plaintext or require the dump to fit in memory.
  await pipeline(
    createReadStream(filePath, { start: 0, end: file.size - 1 }),
    encrypted,
    new Transform({
      transform(_chunk, _encoding, callback) {
        callback();
      },
    }),
  );
  return {
    bytes: file.size,
    plaintextBytes,
    sha256: digest.digest("hex"),
    format: BACKUP_FORMAT,
  };
};

/** Materialize authenticated plaintext for pg_restore. Consumers must use the file only on success. */
export const decryptEncryptedBackupToFile = async (
  filePath: string,
  outputPath: string,
  key: Buffer,
) => {
  const { file, nonce, headerSize } = await readHeader(filePath);
  if (file.size <= headerSize + BACKUP_TAG_BYTES) {
    throw new Error("Backup artifact contains no encrypted dump");
  }
  const tag = Buffer.alloc(BACKUP_TAG_BYTES);
  let offset = 0;
  for await (const chunk of createReadStream(filePath, {
    start: file.size - BACKUP_TAG_BYTES,
    end: file.size - 1,
  })) {
    const bytes = Buffer.from(chunk as Buffer);
    bytes.copy(tag, offset);
    offset += bytes.length;
  }
  if (offset !== BACKUP_TAG_BYTES) throw new Error("Backup authentication tag is truncated");

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(filePath, {
      start: headerSize,
      end: file.size - BACKUP_TAG_BYTES - 1,
    }),
    decipher,
    createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
  );
  return stat(outputPath);
};

export const __test = {
  parseBackupEncryptionKey,
  createBackupCipher,
  decryptEncryptedBackupToFile,
  BACKUP_MAGIC,
  BACKUP_NONCE_BYTES,
  BACKUP_TAG_BYTES,
  BACKUP_KEY_BYTES,
  BACKUP_FORMAT,
};
