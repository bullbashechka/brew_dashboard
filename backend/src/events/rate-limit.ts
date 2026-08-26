import { and, eq } from "drizzle-orm";

import { lockRateLimit, type RequestTransaction } from "../db/client.ts";
import { authRateLimits } from "../db/schema.ts";

export const PRODUCT_EVENT_BURST_WINDOW_SECONDS = 60;
export const PRODUCT_EVENT_BURST_MAX = 30;
export const PRODUCT_EVENT_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
export const PRODUCT_EVENT_DAILY_MAX = 300;

export class ProductEventRateLimitError extends Error {
  constructor(
    readonly retryAfter: number,
    readonly window: "burst" | "daily",
  ) {
    super("Product event rate limit exceeded");
    this.name = "ProductEventRateLimitError";
  }
}

const keyFor = (networkId: string, window: "burst" | "daily") =>
  `product-events:${window}:${networkId}`;

const consumeWindow = async (
  transaction: RequestTransaction,
  input: {
    key: string;
    window: "burst" | "daily";
    windowSeconds: number;
    max: number;
    nowMs: number;
  },
) => {
  await lockRateLimit(transaction, input.key);
  const rows = await transaction
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, input.key))
    .for("update");
  const existing = rows[0];
  if (!existing) {
    await transaction.insert(authRateLimits).values({
      id: crypto.randomUUID(),
      key: input.key,
      count: 1,
      lastRequest: input.nowMs,
    });
    return;
  }

  const windowMs = input.windowSeconds * 1000;
  const elapsed = input.nowMs - existing.lastRequest;
  if (elapsed >= windowMs) {
    await transaction
      .update(authRateLimits)
      .set({ count: 1, lastRequest: input.nowMs })
      .where(eq(authRateLimits.id, existing.id));
    return;
  }

  if (existing.count >= input.max) {
    throw new ProductEventRateLimitError(
      Math.max(1, Math.ceil((windowMs - Math.max(0, elapsed)) / 1000)),
      input.window,
    );
  }

  // Keep lastRequest as the start of this fixed window. Updating it on every
  // accepted event would turn the daily quota into an inactivity timeout.
  await transaction
    .update(authRateLimits)
    .set({ count: existing.count + 1 })
    .where(and(eq(authRateLimits.id, existing.id), eq(authRateLimits.key, input.key)));
};

export const consumeProductEventRateLimit = async (
  transaction: RequestTransaction,
  networkId: string,
  now = new Date(),
) => {
  const nowMs = now.getTime();
  await consumeWindow(transaction, {
    key: keyFor(networkId, "burst"),
    window: "burst",
    windowSeconds: PRODUCT_EVENT_BURST_WINDOW_SECONDS,
    max: PRODUCT_EVENT_BURST_MAX,
    nowMs,
  });
  await consumeWindow(transaction, {
    key: keyFor(networkId, "daily"),
    window: "daily",
    windowSeconds: PRODUCT_EVENT_DAILY_WINDOW_SECONDS,
    max: PRODUCT_EVENT_DAILY_MAX,
    nowMs,
  });
};

export const __test = { keyFor, consumeWindow };
