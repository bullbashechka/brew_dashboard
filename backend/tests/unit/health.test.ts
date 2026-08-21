import { describe, expect, it } from "bun:test";
import { healthResponseSchema } from "@brew-dashboard/contracts";
import { app } from "../../src/index.ts";

describe("GET /api/v1/health", () => {
  it("returns a shared success envelope", async () => {
    const response = await app.request("http://localhost/api/v1/health");
    const body = healthResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("ok");
  });
});
