import { createHmac } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const decodeBase32 = (value: string) => {
  const normalized = value.replace(/[\s=-]/gu, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    const digit = base32Alphabet.indexOf(character);
    if (digit < 0) throw new Error("MFA setup returned an invalid TOTP secret");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return Buffer.from(bytes);
};

export const generateTotp = (secret: string, timestamp = Date.now()) => {
  const counter = BigInt(Math.floor(timestamp / 1_000 / 30));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
};

export const generateStableTotp = async (
  secret: string,
  wait: (milliseconds: number) => Promise<void>,
) => {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 2_000) await wait(remaining + 100);
  return generateTotp(secret);
};

export const __test = { decodeBase32 };
