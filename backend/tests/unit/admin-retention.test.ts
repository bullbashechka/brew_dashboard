import { describe, expect, it } from "bun:test";

import {
  SECURITY_DATA_CLEANUP_BATCH_SIZE,
  SECURITY_DATA_CLEANUP_MAX_ROWS,
  __test as retentionTest,
} from "../../src/admin/retention.ts";

describe("expired security data cleanup policy", () => {
  it("defaults to a bounded dry run", () => {
    const options = retentionTest.validateOptions({});
    expect(options.dryRun).toBe(true);
    expect(options.batchSize).toBe(SECURITY_DATA_CLEANUP_BATCH_SIZE);
    expect(options.maxRows).toBe(SECURITY_DATA_CLEANUP_MAX_ROWS);
  });

  it("rejects unsafe cleanup bounds", () => {
    expect(() => retentionTest.validateOptions({ batchSize: 0 })).toThrow();
    expect(() => retentionTest.validateOptions({ batchSize: 501 })).toThrow();
    expect(() => retentionTest.validateOptions({ maxRows: 0 })).toThrow();
    expect(() => retentionTest.validateOptions({ maxRows: 10_001 })).toThrow();
  });
});
