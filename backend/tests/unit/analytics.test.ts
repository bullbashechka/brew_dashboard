import { describe, expect, it } from "bun:test";

import { signContinuation, verifyContinuation } from "../../src/analytics/http.ts";

const payload = {
  version: 1 as const,
  kind: "cursor" as const,
  endpoint: "sales" as const,
  networkId: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  period: "today" as const,
  locationId: null,
  asOf: "2026-08-25T10:00:00.000Z",
  start: "2026-08-24T19:00:00.000Z",
  end: "2026-08-25T10:00:00.000Z",
  comparisonStart: "2026-08-23T19:00:00.000Z",
  comparisonEnd: "2026-08-24T10:00:00.000Z",
  status: null,
  pageSize: 20,
  lastAt: "2026-08-25T09:00:00.000Z",
  lastId: "22222222-2222-4222-8222-222222222222",
};

describe("analytics continuation tokens", () => {
  it("round-trips signed context and rejects tampering or a different secret", async () => {
    const token = await signContinuation(payload, "analytics-secret");
    await expect(verifyContinuation(token, "analytics-secret")).resolves.toEqual(payload);
    const [encoded, signature] = token.split(".");
    const tampered = `${encoded!.slice(0, -1)}${encoded!.endsWith("a") ? "b" : "a"}.${signature}`;
    await expect(verifyContinuation(tampered, "analytics-secret")).rejects.toThrow(
      "Invalid pagination context",
    );
    await expect(verifyContinuation(token, "different-secret")).rejects.toThrow(
      "Invalid pagination context",
    );
  });
});
