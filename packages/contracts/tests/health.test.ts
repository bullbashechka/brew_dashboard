import { describe, expect, it } from "bun:test";
import { healthResponseSchema } from "../src/index.ts";

describe("healthResponseSchema", () => {
  it("accepts the Worker success envelope", () => {
    const result = healthResponseSchema.parse({
      data: { status: "ok" },
      meta: {},
      requestId: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.data.status).toBe("ok");
  });

  it("rejects an invalid status or request id", () => {
    const result = healthResponseSchema.safeParse({
      data: { status: "ready" },
      meta: {},
      requestId: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });
});
