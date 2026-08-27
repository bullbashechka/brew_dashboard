import { describe, expect, it } from "bun:test";
import type { ProductEventRequest } from "@brew-dashboard/contracts";

import { ApiClientError } from "../../src/api/client";
import { createProductEventDispatcher } from "../../src/lib/product-events";

const request: ProductEventRequest = {
  eventId: "123e4567-e89b-12d3-a456-426614174000",
  type: "section_viewed",
  route: "overview",
  metadata: { section: "overview" },
};

const clientError = (status: number, retryAfterSeconds?: number) =>
  new ApiClientError("request failed", status, "RATE_LIMITED", {}, undefined, retryAfterSeconds);

describe("product event dispatcher", () => {
  it("retries transient failures with bounded network backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const dispatcher = createProductEventDispatcher(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ApiClientError("server failed", 503);
      },
      async (milliseconds) => {
        delays.push(milliseconds);
      },
    );

    await dispatcher.dispatch(request);

    expect(attempts).toBe(3);
    expect(delays).toEqual([250, 1000]);
  });

  it("retries one bounded 429 and reports safe metadata for a terminal failure", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const reports: unknown[] = [];
    const dispatcher = createProductEventDispatcher(
      async () => {
        attempts += 1;
        throw clientError(429, 2);
      },
      async (milliseconds) => {
        delays.push(milliseconds);
      },
      (details) => reports.push(details),
    );

    await dispatcher.dispatch(request);

    expect(attempts).toBe(2);
    expect(delays).toEqual([2000]);
    expect(reports).toEqual([
      {
        eventId: request.eventId,
        type: request.type,
        attempts: 2,
        status: 429,
        code: "RATE_LIMITED",
      },
    ]);
  });

  it("does not retry terminal client errors", async () => {
    let attempts = 0;
    const reports: unknown[] = [];
    const dispatcher = createProductEventDispatcher(
      async () => {
        attempts += 1;
        throw clientError(400);
      },
      async () => {
        throw new Error("wait must not be called");
      },
      (details) => reports.push(details),
    );

    await dispatcher.dispatch(request);

    expect(attempts).toBe(1);
    expect(reports).toEqual([
      {
        eventId: request.eventId,
        type: request.type,
        attempts: 1,
        status: 400,
        code: "RATE_LIMITED",
      },
    ]);
  });
});
