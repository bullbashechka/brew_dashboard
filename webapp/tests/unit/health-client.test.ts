import { afterEach, describe, expect, it, mock } from "bun:test";
import { fetchHealth } from "../../src/api/health";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchHealth", () => {
  it("validates the shared same-origin response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { status: "ok" },
            meta: {},
            requestId: "123e4567-e89b-12d3-a456-426614174000",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await fetchHealth();

    expect(result.data.status).toBe("ok");
  });

  it("rejects failed responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "down" }), { status: 503 })),
    ) as unknown as typeof fetch;

    await expect(fetchHealth()).rejects.toThrow("Health request failed");
  });
});
