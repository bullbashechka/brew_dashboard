import { expect, test } from "./fixtures";
import { SYSTEM_E2E_CANARIES, SYSTEM_E2E_FIXTURES } from "../../scripts/system-e2e-fixture";

test.describe("@system Stage 12 real Worker system journeys", () => {
  test.skip(process.env.E2E_SYSTEM !== "1", "The real Worker journey requires system mode");
  test.setTimeout(300_000);

  test("completes all seven required business journeys and rejects cross-tenant reads and writes", async ({
    page,
    browser,
    baseURL,
    browserFailureGuard,
  }, testInfo) => {
    const fixture =
      testInfo.project.name === "mobile-chromium"
        ? SYSTEM_E2E_FIXTURES.mobile
        : SYSTEM_E2E_FIXTURES.desktop;
    browserFailureGuard.allowHttpError({
      method: "PATCH",
      url: /\/api\/v1\/products\/[^/]+\/price$/u,
      status: 404,
    });
    browserFailureGuard.allowHttpError({
      method: "POST",
      url: /\/api\/v1\/events$/u,
      status: 400,
    });

    await page.goto("/login");
    await page.getByLabel("Login alias").fill(fixture.primary.login);
    await page.getByLabel("Password").fill(fixture.primary.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Choose your language" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up your coffee network" })).toBeVisible();
    await page.getByLabel("Network name").fill(SYSTEM_E2E_CANARIES.networkName);
    await page.getByLabel("Owner name").fill(SYSTEM_E2E_CANARIES.ownerName);
    await page.getByLabel("Number of locations").selectOption("2");
    await page.getByLabel("Location 1 name").fill(SYSTEM_E2E_CANARIES.locationName);
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
      .fill(SYSTEM_E2E_CANARIES.desiredFeatures);
    await feedback.getByLabel("Anything else?").fill(SYSTEM_E2E_CANARIES.feedbackComment);
    await feedback.getByRole("button", { name: "Save feedback" }).click();
    await expect(feedback).toBeHidden();

    await page.getByRole("button", { name: "Reset demo data" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByText("Demo data has been reset.")).toBeVisible({ timeout: 180_000 });
    const restoredFeedback = await page.evaluate(async () => {
      const response = await fetch("/api/v1/feedback");
      const body = (await response.json()) as {
        data?: {
          rating: number;
          comment: string;
          desiredFeatures: string;
        } | null;
      };
      return { status: response.status, feedback: body.data ?? null };
    });
    expect(restoredFeedback.status).toBe(200);
    expect(restoredFeedback.feedback).toEqual({
      rating: 5,
      comment: SYSTEM_E2E_CANARIES.feedbackComment,
      desiredFeatures: SYSTEM_E2E_CANARIES.desiredFeatures,
    });
    await expect(page.getByLabel("What should we add for you to adopt this product?")).toHaveValue(
      SYSTEM_E2E_CANARIES.desiredFeatures,
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
    const primaryLocationId = await page.evaluate(async () => {
      const response = await fetch("/api/v1/locations?period=7d");
      const body = (await response.json()) as {
        data?: { locations?: Array<{ locationId: string }> };
      };
      return body.data?.locations?.[0]?.locationId ?? null;
    });
    expect(primaryLocationId).not.toBeNull();

    const secondaryContext = await browser.newContext({
      baseURL: baseURL ?? "http://127.0.0.1:4173",
    });
    const secondaryPage = await secondaryContext.newPage();
    browserFailureGuard.watchPage(secondaryPage);
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

      const forgedRead = await secondaryPage.evaluate(async (locationId) => {
        const response = await fetch(`/api/v1/overview?period=7d&locationId=${locationId}`);
        const body = (await response.json()) as {
          data?: { locationId?: string | null };
          meta?: { warnings?: Array<{ code: string; field: string }> };
        };
        return {
          status: response.status,
          locationId: body.data?.locationId,
          warnings: body.meta?.warnings,
        };
      }, primaryLocationId!);
      expect(forgedRead.status).toBe(200);
      expect(forgedRead.locationId).toBeNull();
      expect(forgedRead.warnings).toContainEqual({
        code: "INVALID_LOCATION_FALLBACK",
        field: "locationId",
      });

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

      const forgedScope = await secondaryPage.evaluate(async () => {
        const response = await fetch("/api/v1/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventId: crypto.randomUUID(),
            type: "section_viewed",
            route: "overview",
            metadata: { section: "overview" },
            networkId: crypto.randomUUID(),
          }),
        });
        return response.status;
      });
      expect(forgedScope).toBe(400);

      const unchangedPrimary = await page.evaluate(async (id) => {
        const response = await fetch("/api/v1/products?period=7d");
        const body = (await response.json()) as {
          data?: { products?: Array<{ productId: string; currentPrice: string }> };
        };
        return body.data?.products?.find((candidate) => candidate.productId === id) ?? null;
      }, productId);
      expect(unchangedPrimary?.currentPrice).toBe(product!.currentPrice);
    } finally {
      await secondaryContext.close();
    }
  });
});
