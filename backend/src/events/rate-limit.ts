import { type RequestTransaction } from "../db/client.ts";
import { consumeFixedWindow } from "../db/rate-limit.ts";

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
  const result = await consumeFixedWindow(transaction, input);
  if (!result.allowed) {
    throw new ProductEventRateLimitError(result.retryAfter ?? input.windowSeconds, input.window);
  }
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
