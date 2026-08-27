import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InventoryData, Profile } from "@brew-dashboard/contracts";

import {
  InventoryMovementDialog,
  normalizeQuantity,
  remainingQuantity,
} from "../../src/components/inventory-movement-dialog";
import { ApiClientError } from "../../src/api/client";

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

const balance: InventoryData["balances"][number] = {
  inventoryItemId: "123e4567-e89b-12d3-a456-426614174012",
  inventoryItemName: "Coffee beans",
  productId: null,
  productName: null,
  locationId: "123e4567-e89b-12d3-a456-426614174010",
  locationName: "Central",
  unit: "kg",
  onHand: "5.000",
  minThreshold: "1.000",
  status: "in_stock",
};

afterEach(cleanup);

describe("inventory movement dialog", () => {
  it("normalizes quantities without floating-point arithmetic", () => {
    expect(normalizeQuantity("1")).toBe("1.000");
    expect(normalizeQuantity("1.2")).toBe("1.200");
    expect(normalizeQuantity("0")).toBeNull();
    expect(normalizeQuantity("1.0001")).toBeNull();
    expect(remainingQuantity("5.000", "1.250")).toBe("3.750");
  });

  it("blocks a write off above the current balance and shows its impact", async () => {
    const user = userEvent.setup();
    render(
      <InventoryMovementDialog
        balance={balance}
        type="writeoff"
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSave={() => undefined}
        onClearError={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Quantity");
    await user.type(input, "2.5");
    expect(screen.getByText("After write off: 2.5 kg")).toBeDefined();
    await user.clear(input);
    await user.type(input, "6");
    expect(screen.getByText("Quantity cannot exceed the current balance.")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Write off 6 kg" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("submits one canonical receipt despite repeated clicks", async () => {
    const user = userEvent.setup();
    const saves: Array<{ quantity: string }> = [];
    render(
      <InventoryMovementDialog
        balance={balance}
        type="receipt"
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSave={(request) => saves.push(request)}
        onClearError={() => undefined}
      />,
    );
    await user.type(screen.getByLabelText("Quantity"), "1.5");
    await user.dblClick(screen.getByRole("button", { name: "Record receipt" }));
    expect(saves).toHaveLength(1);
    expect(saves[0]?.quantity).toBe("1.500");
  });

  it("keeps the quantity and retries a conflict with the refreshed balance", async () => {
    const user = userEvent.setup();
    const saves: Array<{
      quantity: string;
      expectedDemoDataRevision: number;
      idempotencyKey: string;
    }> = [];
    const props = {
      balance,
      type: "receipt" as const,
      profile,
      open: true,
      pending: false,
      onOpenChange: () => undefined,
      onSave: (request: (typeof saves)[number]) => saves.push(request),
      onClearError: () => undefined,
    };
    const view = render(<InventoryMovementDialog {...props} demoDataRevision={1} error={null} />);
    await user.type(screen.getByLabelText("Quantity"), "1.5");
    await user.click(screen.getByRole("button", { name: "Record receipt" }));

    view.rerender(<InventoryMovementDialog {...props} demoDataRevision={1} error={null} pending />);

    view.rerender(
      <InventoryMovementDialog
        {...props}
        balance={{ ...balance, onHand: "7.000" }}
        demoDataRevision={2}
        error={new ApiClientError("Changed", 409, "CONFLICT")}
        conflictState="ready"
      />,
    );
    expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("1.5");
    expect(screen.getByText("Current balance: 7 kg")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Retry with latest balance" }));
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({ quantity: "1.500", expectedDemoDataRevision: 2 });
    expect(saves[1]?.idempotencyKey).not.toBe(saves[0]?.idempotencyKey);
  });

  it("blocks an outage-time movement while retaining the entered quantity", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    render(
      <InventoryMovementDialog
        balance={balance}
        type="receipt"
        profile={profile}
        demoDataRevision={1}
        open
        pending={false}
        disabled
        error={null}
        onOpenChange={() => undefined}
        onSave={(request) => saves.push(request)}
        onClearError={() => undefined}
      />,
    );
    const input = screen.getByLabelText("Quantity") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Record receipt" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Record receipt" }));
    expect(saves).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });
});
