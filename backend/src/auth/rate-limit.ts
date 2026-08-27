import { createHash } from "node:crypto";
import { and, like, lt, or } from "drizzle-orm";

import { type RequestTransaction } from "../db/client.ts";
import { consumeFixedWindow } from "../db/rate-limit.ts";
import { authRateLimits } from "../db/schema.ts";

export const LOGIN_PAIR_WINDOW_SECONDS = 15 * 60;
export const LOGIN_PAIR_MAX_ATTEMPTS = 5;
export const LOGIN_IP_MAX_ATTEMPTS = 20;
export const LOGIN_GLOBAL_MAX_ATTEMPTS = 300;
export const LOGIN_GLOBAL_KEY = "brew-dashboard:login-global";

const LOGIN_KEY_PREFIX = "brew-dashboard:login-";
const LOGIN_RETENTION_SECONDS = 24 * 60 * 60;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const pairKey = (ipAddress: string, login: string) =>
  `${LOGIN_KEY_PREFIX}pair:${digest(`${ipAddress}\u0000${login}`)}`;

const ipKey = (ipAddress: string) => `${LOGIN_KEY_PREFIX}ip:${digest(ipAddress)}`;

const cleanupExpiredRateLimits = async (transaction: RequestTransaction, nowMs: number) => {
  const loginCutoff = nowMs - LOGIN_PAIR_WINDOW_SECONDS * 1000;
  const retentionCutoff = nowMs - LOGIN_RETENTION_SECONDS * 1000;
  const loginKeys = and(
    like(authRateLimits.key, `${LOGIN_KEY_PREFIX}%`),
    lt(authRateLimits.lastRequest, loginCutoff),
  )!;
  await transaction
    .delete(authRateLimits)
    .where(or(loginKeys, lt(authRateLimits.lastRequest, retentionCutoff)));
};

export class LoginRateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super("Login rate limit exceeded");
    this.name = "LoginRateLimitError";
  }
}

export const consumeLoginRateLimit = async (
  transaction: RequestTransaction,
  ipAddress: string,
  login: string,
) => {
  const nowMs = Date.now();
  const global = await consumeFixedWindow(transaction, {
    key: LOGIN_GLOBAL_KEY,
    windowSeconds: LOGIN_PAIR_WINDOW_SECONDS,
    max: LOGIN_GLOBAL_MAX_ATTEMPTS,
    nowMs,
  });
  if (!global.allowed)
    throw new LoginRateLimitError(global.retryAfter ?? LOGIN_PAIR_WINDOW_SECONDS);
  if (global.startedWindow) await cleanupExpiredRateLimits(transaction, nowMs);

  const ip = await consumeFixedWindow(transaction, {
    key: ipKey(ipAddress),
    windowSeconds: LOGIN_PAIR_WINDOW_SECONDS,
    max: LOGIN_IP_MAX_ATTEMPTS,
    nowMs,
  });
  if (!ip.allowed) throw new LoginRateLimitError(ip.retryAfter ?? LOGIN_PAIR_WINDOW_SECONDS);

  const pair = await consumeFixedWindow(transaction, {
    key: pairKey(ipAddress, login),
    windowSeconds: LOGIN_PAIR_WINDOW_SECONDS,
    max: LOGIN_PAIR_MAX_ATTEMPTS,
    nowMs,
  });
  if (!pair.allowed) throw new LoginRateLimitError(pair.retryAfter ?? LOGIN_PAIR_WINDOW_SECONDS);
};
