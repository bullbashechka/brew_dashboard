import { and, eq, gt } from "drizzle-orm";

import { lockRateLimit, type RequestTransaction } from "./client.ts";
import { authRateLimits } from "./schema.ts";

export type FixedWindowInput = {
  key: string;
  windowSeconds: number;
  max: number;
  nowMs: number;
};

export type FixedWindowResult = {
  allowed: boolean;
  startedWindow: boolean;
  retryAfter: number | null;
};

export const inspectFixedWindow = async (
  transaction: RequestTransaction,
  input: FixedWindowInput,
): Promise<FixedWindowResult> => {
  const rows = await transaction
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, input.key))
    .for("update");
  const existing = rows[0];
  if (!existing) return { allowed: true, startedWindow: true, retryAfter: null };

  const windowMs = input.windowSeconds * 1000;
  const elapsed = input.nowMs - existing.lastRequest;
  if (elapsed >= windowMs) return { allowed: true, startedWindow: true, retryAfter: null };
  if (existing.count < input.max) return { allowed: true, startedWindow: false, retryAfter: null };

  return {
    allowed: false,
    startedWindow: false,
    retryAfter: Math.max(1, Math.ceil((windowMs - Math.max(0, elapsed)) / 1000)),
  };
};

export const clearFixedWindow = async (transaction: RequestTransaction, key: string) => {
  await transaction.delete(authRateLimits).where(eq(authRateLimits.key, key));
};

export const consumeFixedWindow = async (
  transaction: RequestTransaction,
  input: FixedWindowInput,
): Promise<FixedWindowResult> => {
  await lockRateLimit(transaction, input.key);
  const rows = await transaction
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, input.key))
    .for("update");
  const existing = rows[0];
  const windowMs = input.windowSeconds * 1000;

  if (!existing) {
    await transaction.insert(authRateLimits).values({
      id: crypto.randomUUID(),
      key: input.key,
      count: 1,
      lastRequest: input.nowMs,
    });
    return { allowed: true, startedWindow: true, retryAfter: null };
  }

  const elapsed = input.nowMs - existing.lastRequest;
  if (elapsed >= windowMs) {
    await transaction
      .update(authRateLimits)
      .set({ count: 1, lastRequest: input.nowMs })
      .where(eq(authRateLimits.id, existing.id));
    return { allowed: true, startedWindow: true, retryAfter: null };
  }

  if (existing.count >= input.max) {
    return {
      allowed: false,
      startedWindow: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - Math.max(0, elapsed)) / 1000)),
    };
  }

  await transaction
    .update(authRateLimits)
    .set({ count: existing.count + 1 })
    .where(and(eq(authRateLimits.id, existing.id), gt(authRateLimits.count, 0)));
  return { allowed: true, startedWindow: false, retryAfter: null };
};
