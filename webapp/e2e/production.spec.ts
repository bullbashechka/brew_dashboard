import { expect, test } from "./fixtures";

const login = process.env.E2E_PRODUCTION_LOGIN;
const password = process.env.E2E_PRODUCTION_PASSWORD;

test.describe("@production Demo MVP acceptance", () => {
  test.skip(
    process.env.E2E_PRODUCTION !== "1" || !login || !password,
    "Production credentials are supplied only by the guarded backend runner",
  );
  test.setTimeout(300_000);

  test("completes the single-account production acceptance journey", async ({
    page,
    browserFailureGuard,
  }) => {
    browserFailureGuard.allowHttpError({
      method: "GET",
      url: /\/api\/v1\/auth\/me$/u,
      status: 401,
      minTimes: 1,
      maxTimes: 2,
    });

    const health = await page.request.get("/api/v1/health");
    expect(health.status()).toBe(200);
    expect((await health.json()) as { data: { status: string } }).toMatchObject({
      data: { status: "ok" },
    });

    await page.goto("/login");
    await page.getByLabel("Login alias").fill(login!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Choose your language" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up your coffee network" })).toBeVisible();
    await page.getByLabel("Network name").fill("Stage 13 Acceptance");
    await page.getByLabel("Owner name").fill("Demo MVP Reviewer");
    await page.getByLabel("Number of locations").selectOption("2");
    await page.getByLabel("Location 1 name").fill("Central");
    await page.getByLabel("Location 2 name").fill("Airport");
    await page.locator('select[name="country-selection"]').selectOption("KZ");
    await page.locator('input[name="currency"]').fill("KZT");
    await page.getByLabel("Timezone").fill("Asia/Almaty");
    await page.getByRole("button", { name: "Create my dashboard" }).click();

    await expect(page.getByTestId("page-overview")).toBeVisible({ timeout: 180_000 });
    const tour = page.getByRole("dialog");
    if (await tour.count()) await tour.getByRole("button", { name: "Skip tour" }).click();

    await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("7d");
    await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("7d");

    for (const [path, testId] of [
      ["/app/locations?period=7d", "page-locations"],
      ["/app/sales?period=7d", "page-sales"],
      ["/app/products?period=7d", "page-products"],
      ["/app/inventory?period=today", "page-inventory"],
      ["/app/settings?period=today", "page-settings"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: 60_000 });
    }

    await page.goto("/app/products?period=7d");
    await page.getByRole("button", { name: "Edit price" }).first().click();
    await page.getByLabel("Selling price").fill("9.99");
    await page.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("Current price updated.")).toBeVisible();

    await page.goto("/app/inventory?period=today");
    await page.getByRole("button", { name: "Receipt" }).first().click();
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: /Record receipt/u }).click();
    await expect(page.getByText("Receipt recorded.")).toBeVisible();

    await page.goto("/app/settings?period=today");
    await page.getByLabel("Monthly revenue goal").fill("12000");
    await page.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Monthly goal saved.")).toBeVisible();

    await page.getByRole("button", { name: "Feedback", exact: true }).first().click();
    const feedback = page.getByRole("dialog");
    await feedback
      .getByLabel("What should we add for you to adopt this product?")
      .fill("Stage 13 production acceptance");
    await feedback.getByLabel("Anything else?").fill("Feedback must remain tenant-scoped.");
    await feedback.getByRole("button", { name: "Save feedback" }).click();
    await expect(feedback).toBeHidden();

    await page.getByLabel("Language").selectOption("ru");
    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await page.getByLabel("Язык").selectOption("en");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    for (const inaccessibleControl of ["Add order", "Export", "Import", "Forecast"]) {
      expect(
        await page.getByRole("button", { name: inaccessibleControl, exact: true }).count(),
      ).toBe(0);
    }

    await page.getByRole("button", { name: "Reset demo data" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByText("Demo data has been reset.")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByLabel("What should we add for you to adopt this product?")).toHaveValue(
      "Stage 13 production acceptance",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/overview?period=today");
    await expect(page.getByTestId("page-overview")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
