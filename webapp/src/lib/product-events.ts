import type { ProductEventRequest } from "@brew-dashboard/contracts";

import { ApiClientError } from "@/api/client";
import { sendProductEvent } from "@/api/settings";

const MAX_ATTEMPTS = 3;
const NETWORK_RETRY_DELAYS_MS = [250, 1000] as const;
const MAX_RETRY_AFTER_SECONDS = 60;

type SendEvent = (request: ProductEventRequest) => Promise<unknown>;
type Wait = (milliseconds: number) => Promise<void>;
type Report = (details: {
  eventId: string;
  type: ProductEventRequest["type"];
  attempts: number;
  status?: number;
  code?: string;
}) => void;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

const reportFailure: Report = (details) => {
  console.warn("Product event delivery failed", details);
};

const retryDelay = (
  error: unknown,
  retryIndex: number,
  rateLimitRetried: boolean,
): { milliseconds: number; rateLimit: boolean } | null => {
  if (error instanceof ApiClientError && error.status === 429) {
    if (rateLimitRetried || error.retryAfterSeconds === undefined) return null;
    if (!Number.isFinite(error.retryAfterSeconds) || error.retryAfterSeconds < 0) return null;
    if (error.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) return null;
    return { milliseconds: error.retryAfterSeconds * 1000, rateLimit: true };
  }
  if (error instanceof ApiClientError && error.status < 500) return null;
  const milliseconds = NETWORK_RETRY_DELAYS_MS[retryIndex];
  return milliseconds === undefined ? null : { milliseconds, rateLimit: false };
};

export const createProductEventDispatcher = (
  send: SendEvent = sendProductEvent,
  pause: Wait = wait,
  report: Report = reportFailure,
) => ({
  async dispatch(request: ProductEventRequest) {
    let rateLimitRetried = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        await send(request);
        return;
      } catch (error) {
        const next = retryDelay(error, attempt, rateLimitRetried);
        if (!next || attempt === MAX_ATTEMPTS - 1) {
          const details = {
            eventId: request.eventId,
            type: request.type,
            attempts: attempt + 1,
          } as Parameters<Report>[0];
          if (error instanceof ApiClientError) {
            details.status = error.status;
            if (error.code) details.code = error.code;
          }
          report(details);
          return;
        }
        rateLimitRetried ||= next.rateLimit;
        await pause(next.milliseconds);
      }
    }
  },
});

export const productEventDispatcher = createProductEventDispatcher();
