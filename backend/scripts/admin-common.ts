import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { parseLogin } from "../src/auth/login.ts";
import * as schema from "../src/db/schema.ts";
import type { RequestDatabase } from "../src/db/client.ts";
import type { AccountKind } from "../src/admin/accounts.ts";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export const readAdminDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL or DATABASE_PUBLIC_URL is required");
  new URL(databaseUrl);
  return databaseUrl;
};

export const requireProductionAdmin = (databaseUrl: string, confirmation?: string) => {
  const hostname = new URL(databaseUrl).hostname;
  if (loopbackHosts.has(hostname)) return;
  if (process.env.ALLOW_PRODUCTION_ADMIN !== "1" || confirmation !== "production") {
    throw new Error(
      "Non-local admin commands require ALLOW_PRODUCTION_ADMIN=1 and --confirm-production production",
    );
  }
};

export const withAdminDatabase = async <T>(callback: (db: RequestDatabase) => Promise<T>) => {
  const databaseUrl = readAdminDatabaseUrl();
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    return await callback(drizzle(client, { schema }));
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const parseAdminArguments = (allowedFlags: string[], booleanFlags: string[] = []) => {
  const values = new Map<string, string>();
  const allowed = new Set(allowedFlags);
  const booleans = new Set(booleanFlags);
  const argumentsList = process.argv.slice(2);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (!flag?.startsWith("--") || !allowed.has(flag) || values.has(flag)) {
      throw new Error(`Unsupported or repeated argument: ${flag ?? "<missing>"}`);
    }
    if (booleans.has(flag)) {
      values.set(flag, "true");
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  return values;
};

export const requireFlag = (argumentsMap: Map<string, string>, flag: string) => {
  const value = argumentsMap.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
};

export const requireExactConfirmation = (login: string, confirmation: string) => {
  const canonicalLogin = parseLogin(login);
  if (confirmation !== canonicalLogin) {
    throw new Error("--confirm-login must equal the canonical lowercase login");
  }
};

export const parseAccountKind = (value: string | undefined): AccountKind => {
  if (value === "demo" || value === "e2e") return value;
  throw new Error("--account-kind must be demo or e2e");
};

export const parseExpiry = (value: string | undefined) => {
  if (!value) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error("--expires-at must include a UTC offset or Z");
  }
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw new Error("--expires-at must be a valid future timestamp");
  }
  return expiry;
};

const readHiddenLine = async (prompt: string) => {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Interactive password input requires a TTY");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const character of text) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Interactive password input was cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
};

export const readInteractivePassword = async () => {
  const first = await readHiddenLine("Password: ");
  const second = await readHiddenLine("Confirm password: ");
  if (first !== second) throw new Error("Passwords do not match");
  return first;
};
