import { describe, expect, it } from "bun:test";

import { DatabaseConnectionCloseError, __test as databaseClientTest } from "../../src/db/client.ts";

describe("request database client lifecycle", () => {
  it("returns the callback result when connect and close succeed", async () => {
    const calls: string[] = [];
    const result = await databaseClientTest.withClientLifecycle(
      {
        connect: async () => void calls.push("connect"),
        end: async () => void calls.push("end"),
      },
      async () => {
        calls.push("callback");
        return "ok";
      },
    );
    expect(result).toBe("ok");
    expect(calls).toEqual(["connect", "callback", "end"]);
  });

  it("sanitizes a close failure after a successful callback", async () => {
    const records: unknown[] = [];
    const originalError = console.error;
    console.error = ((record: unknown) => records.push(record)) as typeof console.error;
    try {
      await expect(
        databaseClientTest.withClientLifecycle(
          {
            connect: async () => undefined,
            end: async () => {
              throw new Error("postgresql://secret@db.example/close-failed");
            },
          },
          async () => "ok",
        ),
      ).rejects.toBeInstanceOf(DatabaseConnectionCloseError);
    } finally {
      console.error = originalError;
    }
    expect(records).toEqual([{ event: "database_connection_close_failed.v1", errorName: "Error" }]);
    expect(JSON.stringify(records)).not.toContain("postgresql://");
  });

  it("preserves a callback failure when close also fails", async () => {
    const primary = new Error("primary failure");
    const originalError = console.error;
    console.error = (() => undefined) as typeof console.error;
    try {
      await expect(
        databaseClientTest.withClientLifecycle(
          {
            connect: async () => undefined,
            end: async () => {
              throw new Error("close failure");
            },
          },
          async () => {
            throw primary;
          },
        ),
      ).rejects.toBe(primary);
    } finally {
      console.error = originalError;
    }
  });

  it("preserves a connect failure when close also fails", async () => {
    const primary = new Error("connect failure");
    const originalError = console.error;
    console.error = (() => undefined) as typeof console.error;
    try {
      await expect(
        databaseClientTest.withClientLifecycle(
          {
            connect: async () => {
              throw primary;
            },
            end: async () => {
              throw new Error("close failure");
            },
          },
          async () => "unreachable",
        ),
      ).rejects.toBe(primary);
    } finally {
      console.error = originalError;
    }
  });
});
