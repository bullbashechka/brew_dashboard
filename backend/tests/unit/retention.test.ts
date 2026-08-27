import { describe, expect, it } from "bun:test";

import {
  PRODUCT_EVENTS_CLEANUP_BATCH_SIZE,
  PRODUCT_EVENTS_MAX_ROWS_PER_RUN,
  PRODUCT_EVENTS_RETENTION_DAYS,
  __test as retentionTest,
} from "../../src/events/retention.ts";

describe("product event retention policy", () => {
  it("defaults to a 90-day dry run with bounded batches", () => {
    const options = retentionTest.validateOptions({});
    expect(options.retentionDays).toBe(PRODUCT_EVENTS_RETENTION_DAYS);
    expect(options.batchSize).toBe(PRODUCT_EVENTS_CLEANUP_BATCH_SIZE);
    expect(options.maxRows).toBe(PRODUCT_EVENTS_MAX_ROWS_PER_RUN);
    expect(options.dryRun).toBe(true);
  });

  it("rejects unsafe retention and batch values", () => {
    expect(() => retentionTest.validateOptions({ retentionDays: 0 })).toThrow();
    expect(() => retentionTest.validateOptions({ retentionDays: 3651 })).toThrow();
    expect(() => retentionTest.validateOptions({ batchSize: 0 })).toThrow();
    expect(() => retentionTest.validateOptions({ batchSize: 501 })).toThrow();
    expect(() => retentionTest.validateOptions({ maxRows: 0 })).toThrow();
    expect(() =>
      retentionTest.validateOptions({ maxRows: PRODUCT_EVENTS_MAX_ROWS_PER_RUN + 1 }),
    ).toThrow();
    expect(() => retentionTest.validateOptions({ now: new Date("invalid") })).toThrow();
  });
});
