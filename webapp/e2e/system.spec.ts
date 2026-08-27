import { expect, test } from "./fixtures";
import { SYSTEM_E2E_FIXTURES } from "../../scripts/system-e2e-fixture";

test.describe("Stage 12 real Worker system journey", () => {
  test.skip(process.env.E2E_SYSTEM !== "1", "The real Worker journey requires system mode");
  test.setTimeout(300_000);

  test("completes the critical path and rejects cross-tenant reads and writes", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const fixture =
      testInfo.project.name === "mobile-chromium"
        ? SYSTEM_E2E_FIXTURES.mobile
        : SYSTEM_E2E_FIXTURES.desktop;

    await page.goto("/login");
    await page.getByLabel("Login alias").fill(fixture.primary.login);
    await page.getByLabel("Password").fill(fixture.primary.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Choose your language" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up your coffee network" })).toBeVisible();
    await page.getByLabel("Network name").fill("Stage 12 Roast Lab");
    await page.getByLabel("Owner name").fill("Stage 12 Owner");
    await page.getByLabel("Number of locations").selectOption("2");
    await page.getByLabel("Location 1 name").fill("Central");
    await page.getByLabel("Location 2 name").fill("Airport");
    await page.locator('input[name="country"]').fill("KZ");
    await page.locator('input[name="currency"]').fill("KZT");
    await page.getByLabel("Timezone").fill("Asia/Almaty");
    await page.getByRole("button", { name: "Create my dashboard" }).click();

    await expect(page).toHaveURL(/\/app\/overview/);
    await expect(page.getByTestId("page-overview")).toBeVisible({ timeout: 180_000 });
    const tour = page.getByRole("dialog");
    if (await tour.count()) {
      await tour.getByRole("button", { name: "Skip tour" }).click();
      await expect(tour).toBeHidden();
    }

    const filterResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/overview?") &&
        new URL(response.url()).searchParams.get("period") === "7d",
    );
    await page.getByLabel("Period").selectOption("7d");
    await (await filterResponse).finished();
    await expect(page.getByLabel("Period")).toHaveValue("7d");

    await page.goto("/app/products?period=7d");
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    const productsResponse = await page.evaluate(async () => {
      const response = await fetch("/api/v1/products?period=7d");
      return (await response.json()) as {
        data?: { products?: Array<{ productId: string; currentPrice: string; version: number }> };
      };
    });
    const product = productsResponse.data?.products?.[0];
    expect(product).toBeDefined();
    await page.getByRole("button", { name: "Edit price" }).first().click();
    await page.getByLabel("Selling price").fill("9.99");
    await page.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("Current price updated.")).toBeVisible();

    await page.goto("/app/inventory?period=today");
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await page.getByRole("button", { name: "Receipt" }).first().click();
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: /Record receipt/ }).click();
    await expect(page.getByText("Receipt recorded.")).toBeVisible();

    await page.goto("/app/settings?period=today");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByLabel("Monthly revenue goal").fill("12000");
    await page.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Monthly goal saved.")).toBeVisible();

    await page.getByRole("button", { name: "Feedback" }).click();
    const feedback = page.getByRole("dialog");
    await feedback
      .getByLabel("What should we add for you to adopt this product?")
      .fill("System E2E coverage");
    await feedback.getByRole("button", { name: "Save feedback" }).click();
    await expect(feedback).toBeHidden();

    await page.getByRole("button", { name: "Reset demo data" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByText("Demo data has been reset.")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByLabel("What should we add for you to adopt this product?")).toHaveValue(
      "System E2E coverage",
    );
    const restoredProducts = await page.evaluate(async () => {
      const response = await fetch("/api/v1/products?period=7d");
      const body = (await response.json()) as {
        data?: { products?: Array<{ productId: string; currentPrice: string }> };
      };
      return {
        status: response.status,
        product: body.data?.products?.[0] ?? null,
      };
    });
    expect(restoredProducts.status).toBe(200);
    expect(restoredProducts.product?.productId).toBe(product!.productId);
    expect(restoredProducts.product?.currentPrice).toBe(product!.currentPrice);

    const secondaryContext = await browser.newContext({
      baseURL: baseURL ?? "http://127.0.0.1:4173",
    });
    const secondaryPage = await secondaryContext.newPage();
    try {
      await secondaryPage.goto("/login");
      await secondaryPage.getByLabel("Login alias").fill(fixture.secondary.login);
      await secondaryPage.getByLabel("Password").fill(fixture.secondary.password);
      await secondaryPage.getByRole("button", { name: "Sign in" }).click();
      await expect(secondaryPage.getByTestId("page-overview")).toBeVisible({ timeout: 180_000 });

      const productId = product!.productId;
      const secondaryProducts = await secondaryPage.evaluate(async () => {
        const response = await fetch("/api/v1/products?period=7d");
        const body = (await response.json()) as {
          data?: { products?: Array<{ productId: string }> };
        };
        return {
          status: response.status,
          productIds: body.data?.products?.map(({ productId: id }) => id) ?? [],
        };
      });
      expect(secondaryProducts.status).toBe(200);
      expect(secondaryProducts.productIds).not.toContain(productId);

      const forgedWrite = await secondaryPage.evaluate(async (id) => {
        const response = await fetch(`/api/v1/products/${id}/price`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "1.00",
            expectedVersion: 1,
            expectedDemoDataRevision: 1,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        return response.status;
      }, productId);
      expect(forgedWrite).toBe(404);
    } finally {
      await secondaryContext.close();
    }
  });
});
