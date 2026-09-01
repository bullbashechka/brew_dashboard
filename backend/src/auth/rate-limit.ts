import { and, asc, inArray, like, lt } from "drizzle-orm";

import { type RequestTransaction } from "../db/client.ts";
import { consumeFixedWindow, inspectFixedWindow, clearFixedWindow } from "../db/rate-limit.ts";
import { authRateLimits } from "../db/schema.ts";
import { consumeMemoryFixedWindow, rateLimitKey, trustedClientIp } from "../http/rate-limit.ts";
import { consumeDurableRateLimit } from "../http/rate-limit-actor.ts";
import type { WorkerBindings } from "../http/types.ts";
import { allowsLocalRateLimitFallback } from "./mfa-policy.ts";

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_ACCOUNT_MAX_FAILURES = 10;
export const LOGIN_IP_MAX_ATTEMPTS = 50;
export const AUTHENTICATED_READ_WINDOW_SECONDS = 60;
export const AUTHENTICATED_READ_MAX_REQUESTS = 120;
export const AUTHENTICATED_MUTATION_WINDOW_SECONDS = 60;
export const AUTHENTICATED_MUTATION_MAX_REQUESTS = 30;
export const DEMO_RESET_WINDOW_SECONDS = 60 * 60;
export const DEMO_RESET_MAX_REQUESTS = 3;

const LOGIN_KEY_PREFIX = "brew-dashboard:login-account:";
const LOGIN_RETENTION_SECONDS = 24 * 60 * 60;
const LOGIN_CLEANUP_BATCH_SIZE = 500;
let lastCleanupAt = 0;

export const loginAccountRateLimitKey = (secret: string, loginNormalized: string) =>
  rateLimitKey(secret, "login-account", loginNormalized);

const loginIpRateLimitKey = (secret: string, ipAddress: string) =>
  rateLimitKey(secret, "login-ip", trustedClientIp(ipAddress));

export const consumeLoginIpRateLimit = (secret: string, ipAddress: string | undefined) =>
  consumeMemoryFixedWindow({
    key: loginIpRateLimitKey(secret, ipAddress ?? "unknown"),
    windowSeconds: LOGIN_WINDOW_SECONDS,
    max: LOGIN_IP_MAX_ATTEMPTS,
  });

export const consumeLoginIpRateLimitDistributed = (
  bindings: WorkerBindings,
  secret: string,
  ipAddress: string | undefined,
) => {
  const key = loginIpRateLimitKey(secret, ipAddress ?? "unknown");
  // Unit/integration workers intentionally omit production-only bindings. A production MFA or
  // split-runtime deployment with a missing DO is a deployment error and must fail closed.
  if (
    !bindings.RATE_LIMIT_ACTOR &&
    !bindings.AUTH_HYPERDRIVE &&
    !bindings.APP_HYPERDRIVE &&
    allowsLocalRateLimitFallback(bindings)
  ) {
    return Promise.resolve({
      status: "ok" as const,
      result: consumeMemoryFixedWindow({
        key,
        windowSeconds: LOGIN_WINDOW_SECONDS,
        max: LOGIN_IP_MAX_ATTEMPTS,
      }),
    });
  }
  return consumeDurableRateLimit(
    bindings.RATE_LIMIT_ACTOR,
    secret,
    key,
    LOGIN_WINDOW_SECONDS,
    LOGIN_IP_MAX_ATTEMPTS,
  );
};

export const consumeAuthenticatedRequestRateLimit = (
  secret: string,
  authUserId: string,
  method: string,
  path: string,
) => {
  if (path.endsWith("/events")) return null;

  const isReset = path.endsWith("/demo/reset");
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const scope = isReset ? "demo-reset" : isMutation ? "api-mutation" : "api-read";
  const windowSeconds = isReset
    ? DEMO_RESET_WINDOW_SECONDS
    : isMutation
      ? AUTHENTICATED_MUTATION_WINDOW_SECONDS
      : AUTHENTICATED_READ_WINDOW_SECONDS;
  const max = isReset
    ? DEMO_RESET_MAX_REQUESTS
    : isMutation
      ? AUTHENTICATED_MUTATION_MAX_REQUESTS
      : AUTHENTICATED_READ_MAX_REQUESTS;
  const key = rateLimitKey(secret, scope, authUserId);
  return { scope, key, ...consumeMemoryFixedWindow({ key, windowSeconds, max }) };
};

export const consumeAuthenticatedRequestRateLimitDistributed = (
  bindings: WorkerBindings,
  secret: string,
  authUserId: string,
  method: string,
  path: string,
): Promise<
  | null
  | { status: "unavailable"; error: unknown }
  | {
      status: "ok";
      result: { scope: string; key: string; allowed: boolean; retryAfter: number | null };
    }
> => {
  if (path.endsWith("/events")) return Promise.resolve(null);
  const isReset = path.endsWith("/demo/reset");
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const scope = isReset ? "demo-reset" : isMutation ? "api-mutation" : "api-read";
  const windowSeconds = isReset
    ? DEMO_RESET_WINDOW_SECONDS
    : isMutation
      ? AUTHENTICATED_MUTATION_WINDOW_SECONDS
      : AUTHENTICATED_READ_WINDOW_SECONDS;
  const max = isReset
    ? DEMO_RESET_MAX_REQUESTS
    : isMutation
      ? AUTHENTICATED_MUTATION_MAX_REQUESTS
      : AUTHENTICATED_READ_MAX_REQUESTS;
  const key = rateLimitKey(secret, scope, authUserId);
  if (
    !bindings.RATE_LIMIT_ACTOR &&
    !bindings.AUTH_HYPERDRIVE &&
    !bindings.APP_HYPERDRIVE &&
    allowsLocalRateLimitFallback(bindings)
  ) {
    return Promise.resolve({
      status: "ok" as const,
      result: { ...consumeMemoryFixedWindow({ key, windowSeconds, max }), scope, key },
    });
  }
  return consumeDurableRateLimit(bindings.RATE_LIMIT_ACTOR, secret, key, windowSeconds, max).then(
    (result) =>
      result.status === "ok"
        ? { status: "ok" as const, result: { ...result.result, scope, key } }
        : result,
  );
};

const cleanupExpiredRateLimits = async (transaction: RequestTransaction, nowMs: number) => {
  if (nowMs - lastCleanupAt < LOGIN_WINDOW_SECONDS * 1000) return;
  lastCleanupAt = nowMs;
  const retentionCutoff = nowMs - LOGIN_RETENTION_SECONDS * 1000;
  const stale = await transaction
    .select({ id: authRateLimits.id })
    .from(authRateLimits)
    .where(
      and(
        like(authRateLimits.key, `${LOGIN_KEY_PREFIX}%`),
        lt(authRateLimits.lastRequest, retentionCutoff),
      ),
    )
    .orderBy(asc(authRateLimits.lastRequest))
    .limit(LOGIN_CLEANUP_BATCH_SIZE);
  if (!stale.length) return;
  await transaction.delete(authRateLimits).where(
    inArray(
      authRateLimits.id,
      stale.map((row) => row.id),
    ),
  );
};

export const checkLoginAccountRateLimit = async (
  transaction: RequestTransaction,
  accountKey: string,
) => {
  const nowMs = Date.now();
  await cleanupExpiredRateLimits(transaction, nowMs);
  return inspectFixedWindow(transaction, {
    key: accountKey,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    max: LOGIN_ACCOUNT_MAX_FAILURES,
    nowMs,
  });
};

export const recordLoginFailure = async (transaction: RequestTransaction, accountKey: string) =>
  consumeFixedWindow(transaction, {
    key: accountKey,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    max: LOGIN_ACCOUNT_MAX_FAILURES,
    nowMs: Date.now(),
  });

export const clearLoginFailures = (transaction: RequestTransaction, accountKey: string) =>
  clearFixedWindow(transaction, accountKey);

export const __test = {
  resetCleanupClock: () => {
    lastCleanupAt = 0;
  },
};
