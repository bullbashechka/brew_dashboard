import { expect, test } from "@playwright/test";

test("serves the SPA and health API from one origin", async ({ page, request, baseURL }) => {
  const homeResponse = await page.goto("/");

  expect(homeResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Brew Dashboard" })).toBeVisible();
  await expect(page.getByTestId("api-status")).toHaveText("API ready");

  const healthResponse = await request.get(`${baseURL}/api/v1/health`);
  expect(healthResponse.status()).toBe(200);
  expect((await healthResponse.json()).data.status).toBe("ok");
});

test("keeps SPA fallback and API 404 boundaries separate", async ({ page, request, baseURL }) => {
  const clientRouteResponse = await page.goto("/unknown-client-route");

  expect(clientRouteResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  const apiResponse = await request.get(`${baseURL}/api/v1/missing`);
  expect(apiResponse.status()).toBe(404);
  expect(apiResponse.headers()["content-type"]).toContain("application/json");
});
