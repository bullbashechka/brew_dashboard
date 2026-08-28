import { expect, test } from "./fixtures";

const profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "demo.owner",
  networkId: "123e4567-e89b-12d3-a456-426614174001",
  networkName: "Roast Lab",
  ownerName: "Alex",
  country: "KZ",
  currency: "KZT",
  timeZone: "Asia/Almaty",
  language: "en",
  effectiveLanguage: "en",
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-01-01",
  demoDataRevision: 1,
  demoDataStale: false,
  tourState: "completed",
  expiresAt: null,
};
const apiError = {
  error: { code: "INTERNAL_ERROR", message: "safe", fields: {} },
  requestId: "123e4567-e89b-12d3-a456-426614174099",
};

test("keeps the SPA/API fallback boundary and directs guests to login", async ({
  page,
  request,
  baseURL,
  browserFailureGuard,
}) => {
  browserFailureGuard.allowHttpError({
    method: "GET",
    url: /\/api\/v1\/auth\/me$/u,
    status: 401,
    times: 2,
  });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ...apiError, error: { ...apiError.error, code: "UNAUTHENTICATED" } }),
    }),
  );
  const homeResponse = await page.goto("/");
  expect(homeResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  const clientRouteResponse = await page.goto("/unknown-client-route");
  expect(clientRouteResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  const healthResponse = await request.get(`${baseURL}/api/v1/health`);
  expect(healthResponse.status()).toBe(200);
  expect((await healthResponse.json()).data.status).toBe("ok");

  const missingApiResponse = await request.get(`${baseURL}/api/v1/missing`);
  expect(missingApiResponse.status()).toBe(404);
  expect(missingApiResponse.headers()["content-type"]).toContain("application/json");
});

test("renders the compact guarded shell without horizontal page overflow", async ({
  page,
  browserFailureGuard,
}) => {
  browserFailureGuard.allowHttpError({
    method: "GET",
    url: /\/api\/v1\/locations\?period=today$/u,
    status: 500,
    times: 3,
  });
  browserFailureGuard.allowHttpError({
    method: "GET",
    url: /\/api\/v1\/overview\?period=7d(?:&locationId=.*)?$/u,
    status: 500,
    times: 4,
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { authenticated: true, profile },
        meta: {},
        requestId: "123e4567-e89b-12d3-a456-426614174010",
      }),
    }),
  );
  await page.route("**/api/v1/locations?period=today", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );
  await page.route("**/api/v1/overview?*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );

  await page.goto("/app/overview?period=7d");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByLabel("Period")).toHaveValue("7d");
  await page.getByLabel("Open navigation").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  for (const width of [320, 767, 768, 1279, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await page.goto(`/app/overview?period=7d&locationId=${profile.networkId}`);
  await page.getByLabel("Location").selectOption("");
  await expect.poll(() => new URL(page.url()).searchParams.get("locationId")).toBeNull();

  await page.goto(`/app/overview?period=7d&locationId=${profile.networkId}`);
  await page.getByRole("link", { name: "Settings" }).click();
  expect(new URL(page.url()).searchParams.get("period")).toBe("7d");
  expect(new URL(page.url()).searchParams.get("locationId")).toBe(profile.networkId);
});

test("localizes public and guarded routes", async ({ page, browserFailureGuard }) => {
  for (const path of ["locations?period=today", "overview?period=today"]) {
    browserFailureGuard.allowHttpError({
      method: "GET",
      url: new RegExp(`/api/v1/${path.replace("?", "\\?")}$`, "u"),
      status: 500,
    });
  }
  const russianProfile = { ...profile, language: "ru", effectiveLanguage: "ru" };
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { authenticated: true, profile: russianProfile },
        meta: {},
        requestId: "123e4567-e89b-12d3-a456-426614174011",
      }),
    }),
  );
  await page.route("**/api/v1/locations?period=today", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );
  await page.route("**/api/v1/overview?period=today", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );

  await page.goto("/app/overview?period=today");
  await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toHaveAttribute(
    "href",
    "#main-content",
  );
});

test("returns to login after an authenticated API request receives 401", async ({
  page,
  browserFailureGuard,
}) => {
  browserFailureGuard.allowHttpError({
    method: "GET",
    url: /\/api\/v1\/overview\?period=7d$/u,
    status: 401,
  });
  browserFailureGuard.allowHttpError({
    method: "GET",
    url: /\/api\/v1\/locations\?period=today$/u,
    status: 500,
    minTimes: 0,
    maxTimes: 1,
  });
  browserFailureGuard.allowHttpError({
    method: "GET",
    url: /\/api\/v1\/auth\/me$/u,
    status: 401,
  });
  let sessionRequests = 0;
  await page.route("**/api/v1/auth/me", (route) => {
    sessionRequests += 1;
    return route.fulfill(
      sessionRequests === 1
        ? {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: { authenticated: true, profile },
              meta: {},
              requestId: "123e4567-e89b-12d3-a456-426614174012",
            }),
          }
        : {
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              ...apiError,
              error: { ...apiError.error, code: "UNAUTHENTICATED" },
            }),
          },
    );
  });
  await page.route("**/api/v1/locations?period=today", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );
  await page.route("**/api/v1/overview?period=7d", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ...apiError, error: { ...apiError.error, code: "UNAUTHENTICATED" } }),
    }),
  );

  await page.goto("/app/overview?period=7d");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
