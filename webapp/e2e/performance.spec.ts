import { expect, test, type Page } from "./fixtures";
import { SYSTEM_E2E_FIXTURES } from "../../scripts/system-e2e-fixture";

const budgets = {
  firstUsefulScreenMs: 3_000,
  filterReactionMs: 1_000,
  mutationMs: 2_000,
} as const;

const profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "e2e.performance",
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

const errorResponse = () => ({
  error: { code: "INTERNAL_ERROR", message: "safe", fields: {} },
  requestId: crypto.randomUUID(),
});

const installRoutes = async (page: Page) => {
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify(errorResponse()),
    }),
  );
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { authenticated: true, profile },
        meta: {},
        requestId: crypto.randomUUID(),
      }),
    }),
  );
  await page.route("**/api/v1/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { eventId: crypto.randomUUID() },
        meta: {},
        requestId: crypto.randomUUID(),
      }),
    }),
  );
};

const prepareSystemAccount = async (
  page: Page,
  credentials: { login: string; password: string },
) => {
  await page.goto("/login");
  await page.getByLabel("Login alias").fill(credentials.login);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("page-overview")).toBeVisible({ timeout: 180_000 });
  const tour = page.getByRole("dialog");
  if (await tour.count()) {
    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
  }
};

test("@performance enforces first-screen, filter and mutation release budgets", async ({
  page,
  browserFailureGuard,
}, testInfo) => {
  test.setTimeout(300_000);
  const system = process.env.E2E_SYSTEM === "1";
  test.skip(
    !system,
    "Release performance measurements require the real Worker and isolated PostgreSQL",
  );
  if (system) {
    browserFailureGuard.allowHttpError({
      method: "GET",
      url: /\/api\/v1\/auth\/me$/u,
      status: 401,
    });
    const fixture =
      testInfo.project.name === "mobile-chromium"
        ? SYSTEM_E2E_FIXTURES.mobile.performance
        : SYSTEM_E2E_FIXTURES.desktop.performance;
    await prepareSystemAccount(page, fixture);
  } else {
    for (const path of [
      "overview?period=today",
      "feedback",
      "locations?period=today",
      "overview?period=7d",
    ]) {
      browserFailureGuard.allowHttpError({
        method: "GET",
        url: new RegExp(`/api/v1/${path.replace("?", "\\?")}$`, "u"),
        status: 500,
      });
    }
    await installRoutes(page);
  }
  const measurements: Record<string, number> = {};

  let startedAt = Date.now();
  await page.goto("/app/overview?period=today", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("page-overview")).toBeVisible();
  const revenueCard = page
    .getByTestId("page-overview")
    .locator("article")
    .filter({ has: page.getByText("Revenue", { exact: true }) })
    .first();
  const initialRevenue = system ? await revenueCard.locator("p").nth(1).textContent() : null;
  if (system) {
    await expect(revenueCard.getByText("Revenue", { exact: true })).toBeVisible();
    expect(initialRevenue).not.toBeNull();
  }
  measurements.firstUsefulScreenMs = Date.now() - startedAt;
  expect(measurements.firstUsefulScreenMs).toBeLessThanOrEqual(budgets.firstUsefulScreenMs);

  const filterResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/overview?") &&
      new URL(response.url()).searchParams.get("period") === "7d",
  );
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("7d");
  const response = await filterResponse;
  await response.finished();
  const responseFinishedAt = Date.now();
  if (system) {
    await expect.poll(() => revenueCard.locator("p").nth(1).textContent()).not.toBe(initialRevenue);
  } else {
    await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("7d");
  }
  measurements.filterReactionMs = Date.now() - responseFinishedAt;
  expect(measurements.filterReactionMs).toBeLessThanOrEqual(budgets.filterReactionMs);

  if (system) {
    await page.goto("/app/settings?period=today");
    await expect(page.getByLabel("Monthly revenue goal")).toBeVisible();
    await page.getByLabel("Monthly revenue goal").fill("12000");
    startedAt = Date.now();
    await page.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Monthly goal saved.")).toBeVisible();
  } else {
    startedAt = Date.now();
    const mutation = await page.evaluate(async () => {
      const response = await fetch("/api/v1/events", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          type: "section_viewed",
          route: "overview",
          metadata: { section: "overview" },
        }),
      });
      return response.status;
    });
    expect(mutation).toBe(200);
  }
  measurements.mutationMs = Date.now() - startedAt;
  expect(measurements.mutationMs).toBeLessThanOrEqual(budgets.mutationMs);

  await testInfo.attach("performance-budget.json", {
    body: JSON.stringify({ budgets, measurements }, null, 2),
    contentType: "application/json",
  });
});
