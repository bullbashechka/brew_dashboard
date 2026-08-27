import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProductAnalytics, Profile } from "@brew-dashboard/contracts";

import { ApiClientError } from "../../src/api/client";
import { PriceDialog, normalizePrice } from "../../src/components/product-price-dialog";

const profile: Profile = {
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

const product: ProductAnalytics = {
  productId: "123e4567-e89b-12d3-a456-426614174012",
  name: "House Latte",
  categoryId: "123e4567-e89b-12d3-a456-426614174013",
  categoryName: "Coffee",
  active: true,
  currentPrice: "6.50",
  currentUnitCost: "2.40",
  unitContribution: "4.10",
  currentUnitMargin: "63.08",
  version: 1,
  unitsSold: "10.000",
  revenue: "65.00",
  grossProfit: "41.00",
  grossMargin: "63.08",
  revenueShare: "50.00",
  balances: [
    {
      locationId: "123e4567-e89b-12d3-a456-426614174010",
      locationName: "Central",
      onHand: "4.000",
      status: "in_stock",
    },
  ],
  menuGroup: "stars",
  recommendation: "protect_and_promote",
};

afterEach(cleanup);

describe("price dialog", () => {
  it("normalizes a valid money string without rounding", () => {
    expect(normalizePrice("12.5")).toBe("12.50");
    expect(normalizePrice("0")).toBe("0.00");
    expect(normalizePrice("")).toBeNull();
    expect(normalizePrice("00")).toBeNull();
    expect(normalizePrice("12.567")).toBeNull();
  });

  it("warns about zero price and submits the canonical value once", async () => {
    const user = userEvent.setup();
    const saves: Array<{ price: string }> = [];
    render(
      <PriceDialog
        product={product}
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSave={(_, request) => saves.push(request)}
        onClearError={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Selling price");
    await user.clear(input);
    await user.type(input, "0");
    expect(screen.getByText(/zero price makes the current unit margin unavailable/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Save price" }));
    expect(saves).toHaveLength(1);
    expect(saves[0]?.price).toBe("0.00");
  });

  it("disables saving when the value is empty or unchanged", async () => {
    const user = userEvent.setup();
    const saves: Array<{ price: string }> = [];
    render(
      <PriceDialog
        product={product}
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSave={(_, request) => saves.push(request)}
        onClearError={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Selling price");
    const save = screen.getByRole("button", { name: "Save price" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, product.currentPrice);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(saves).toHaveLength(0);
  });

  it("locks duplicate clicks until the mutation leaves pending state", async () => {
    const user = userEvent.setup();
    const saves: Array<{ price: string }> = [];
    render(
      <PriceDialog
        product={product}
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSave={(_, request) => saves.push(request)}
        onClearError={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Selling price");
    await user.clear(input);
    await user.type(input, "9.99");
    const save = screen.getByRole("button", { name: "Save price" });
    await user.dblClick(save);
    expect(saves).toHaveLength(1);
  });

  it("keeps the entered price while exposing explicit conflict actions", () => {
    render(
      <PriceDialog
        product={product}
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={new ApiClientError("Changed", 409, "CONFLICT")}
        onOpenChange={() => undefined}
        onSave={() => undefined}
        onClearError={() => undefined}
      />,
    );
    expect(screen.getByText(/product changed in another tab/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Use latest price" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Overwrite with my price" })).toBeDefined();
  });

  it("clears a conflict when the dialog is closed", async () => {
    const user = userEvent.setup();
    let cleared = 0;
    render(
      <PriceDialog
        product={product}
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={new ApiClientError("Changed", 409, "CONFLICT")}
        onOpenChange={() => undefined}
        onSave={() => undefined}
        onClearError={() => {
          cleared += 1;
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cleared).toBe(1);
  });

  it("preserves the draft but blocks saving during an analytics outage", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    render(
      <PriceDialog
        product={product}
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        disabled
        error={null}
        onOpenChange={() => undefined}
        onSave={(_, request) => saves.push(request)}
        onClearError={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Selling price") as HTMLInputElement;
    expect(input.value).toBe("6.50");
    expect((screen.getByRole("button", { name: "Save price" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Save price" }));
    expect(saves).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });
});
