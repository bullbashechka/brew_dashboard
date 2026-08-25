import { expect, test } from "@playwright/test";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
const apiError = {
  error: { code: "INTERNAL_ERROR", message: "safe", fields: {} },
  requestId,
};

const incompleteProfile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "demo.owner",
  networkId: "123e4567-e89b-12d3-a456-426614174001",
  networkName: null,
  ownerName: null,
  country: null,
  currency: null,
  timeZone: null,
  language: null,
  effectiveLanguage: "en",
  onboardingCompletedAt: null,
  demoGeneratorVersion: null,
  demoGeneratedForDate: null,
  demoDataRevision: 0,
  demoDataStale: false,
  tourState: "pending",
  expiresAt: null,
} as const;

const completeProfile = {
  ...incompleteProfile,
  networkName: "Roast Lab",
  ownerName: "Alex Owner",
  country: "KZ",
  currency: "KZT",
  timeZone: "Asia/Almaty",
  language: "en",
  onboardingCompletedAt: "2026-08-25T10:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-08-25",
  demoDataRevision: 1,
} as const;

test("completes Login → Language → Onboarding → Overview → Tour and can restart it", async ({
  page,
}) => {
  let profile: typeof incompleteProfile | typeof completeProfile | null = null;
  const tourStates: string[] = [];

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill(
      profile
        ? {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: { authenticated: true, profile }, meta: {}, requestId }),
          }
        : {
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              ...apiError,
              error: { ...apiError.error, code: "UNAUTHENTICATED" },
            }),
          },
    ),
  );
  await page.route("**/api/v1/auth/login", async (route) => {
    profile = incompleteProfile;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { authenticated: true, profile }, meta: {}, requestId }),
    });
  });
  await page.route("**/api/v1/onboarding/language", async (route) => {
    profile = { ...incompleteProfile, language: "en", effectiveLanguage: "en" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { language: "en", effectiveLanguage: "en" },
        meta: {},
        requestId,
      }),
    });
  });
  await page.route("**/api/v1/onboarding/complete", async (route) => {
    profile = completeProfile;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          profile,
          generation: {
            version: "v1",
            generatedForDate: "2026-08-25",
            anchor: "2026-08-25T10:00:00.000Z",
            seed: 1,
            revision: 1,
            stale: false,
          },
          counts: {
            locations: 3,
            categories: 3,
            products: 12,
            orders: 100,
            orderItems: 200,
            inventoryItems: 12,
            inventoryBalances: 36,
            inventoryMovements: 36,
            revenueTargets: 1,
          },
        },
        meta: {},
        requestId,
      }),
    });
  });
  await page.route("**/api/v1/settings/tour", async (route) => {
    const state = (await route.request().postDataJSON()).state as
      "pending" | "completed" | "skipped";
    tourStates.push(state);
    profile = { ...completeProfile, tourState: state };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { state }, meta: {}, requestId }),
    });
  });
  await page.route("**/api/v1/locations?*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );
  await page.route("**/api/v1/overview?*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(apiError) }),
  );

  await page.goto("/");
  await page.getByLabel("Login alias").fill("demo.owner");
  await page.getByLabel("Password").fill("Valid-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose your language" })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up your coffee network" })).toBeVisible();
  await page.getByLabel("Network name").fill("Roast Lab");
  await page.getByLabel("Owner name").fill("Alex Owner");
  await page.getByLabel("Location 1 name").fill("Central");
  await page.getByLabel("Location 2 name").fill("Airport");
  await page.getByLabel("Location 3 name").fill("Riverside");
  await page.locator('input[name="country"]').fill("KZ");
  await page.locator('input[name="currency"]').fill("KZT");
  await page.getByLabel("Timezone").fill("Asia/Almaty");
  await page.getByRole("button", { name: "Create my dashboard" }).click();

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Step 1 of 3");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/app\/locations/);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/app\/inventory/);
  await page.getByRole("button", { name: "Finish tour" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(tourStates).toEqual(["completed"]);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Start tour" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect.poll(() => tourStates).toEqual(["completed", "pending", "skipped"]);
});
