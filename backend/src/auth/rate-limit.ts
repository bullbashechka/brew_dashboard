import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";

import { lockLogin, type RequestTransaction } from "../db/client.ts";
import { authRateLimits } from "../db/schema.ts";

export const LOGIN_PAIR_WINDOW_SECONDS = 15 * 60;
export const LOGIN_PAIR_MAX_ATTEMPTS = 5;

const keyFor = (ipAddress: string, login: string) =>
  `brew-dashboard:login-pair:${createHash("sha256")
    .update(`${ipAddress}\u0000${login}`)
    .digest("hex")}`;

export class LoginRateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super("Login rate limit exceeded");
    this.name = "LoginRateLimitError";
  }
}

export const consumeLoginPairRateLimit = async (
  transaction: RequestTransaction,
  ipAddress: string,
  login: string,
) => {
  const key = keyFor(ipAddress, login);
  await lockLogin(transaction, `rate-limit:${key}`);
  const now = Date.now();
  const rows = await transaction
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, key))
    .for("update");
  const existing = rows[0];

  if (!existing) {
    await transaction.insert(authRateLimits).values({
      id: randomUUID(),
      key,
      count: 1,
      lastRequest: now,
    });
    return;
  }

  const elapsed = now - existing.lastRequest;
  const windowMs = LOGIN_PAIR_WINDOW_SECONDS * 1000;
  if (elapsed >= windowMs) {
    await transaction
      .update(authRateLimits)
      .set({ count: 1, lastRequest: now })
      .where(eq(authRateLimits.id, existing.id));
    return;
  }

  if (existing.count >= LOGIN_PAIR_MAX_ATTEMPTS) {
    throw new LoginRateLimitError(Math.max(1, Math.ceil((windowMs - elapsed) / 1000)));
  }

  await transaction
    .update(authRateLimits)
    .set({ count: existing.count + 1, lastRequest: now })
    .where(and(eq(authRateLimits.id, existing.id), gt(authRateLimits.count, 0)));
};

export const __test = { keyFor };
