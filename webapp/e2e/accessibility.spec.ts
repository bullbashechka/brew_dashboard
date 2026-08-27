import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

const profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "e2e.accessibility",
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

const scan = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
};

test("keeps the public login surface WCAG AA clean", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHENTICATED", message: "safe", fields: {} },
        requestId: crypto.randomUUID(),
      }),
    }),
  );
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await scan(page);
});

test("keeps the guarded loading/error surface keyboard and WCAG AA accessible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "safe", fields: {} },
        requestId: crypto.randomUUID(),
      }),
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
  await page.goto("/app/overview?period=today");
  await expect(page.getByTestId("page-overview")).toBeVisible();
  await page.getByLabel("Open navigation").focus();
  await expect(page.getByLabel("Open navigation")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await scan(page);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
    true,
  );
});

test("keeps the first-run form labels and validation surface WCAG AA accessible", async ({
  page,
}) => {
  const incompleteProfile = {
    ...profile,
    networkName: null,
    ownerName: null,
    country: null,
    currency: null,
    timeZone: null,
    language: "en",
    effectiveLanguage: "en",
    onboardingCompletedAt: null,
    demoGeneratorVersion: null,
    demoGeneratedForDate: null,
    demoDataRevision: 0,
    tourState: "pending",
  };
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { authenticated: true, profile: incompleteProfile },
        meta: {},
        requestId: crypto.randomUUID(),
      }),
    }),
  );
  await page.goto("/first-run/onboarding");
  await expect(page.getByRole("heading", { name: "Set up your coffee network" })).toBeVisible();
  await page.getByRole("button", { name: "Create my dashboard" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await scan(page);
});
