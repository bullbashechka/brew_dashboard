import { describe, expect, it } from "bun:test";
import { app, notFoundResponseSchema } from "../../src/index.ts";

describe("Worker API routing", () => {
  it("keeps unknown API paths as JSON 404 responses", async () => {
    const response = await app.request("http://localhost/api/v1/missing");
    const body = notFoundResponseSchema.parse(await response.json());

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
