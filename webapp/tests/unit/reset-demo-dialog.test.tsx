import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ResetDemoDialog } from "../../src/components/reset-demo-dialog";

afterEach(cleanup);

describe("reset demo dialog", () => {
  it("exposes confirmation and cancellation actions", async () => {
    const user = userEvent.setup();
    const onConfirm = mock(() => undefined);
    const onOpenChange = mock(() => undefined);
    render(
      <ResetDemoDialog
        open
        onOpenChange={onOpenChange}
        locale="en"
        pending={false}
        error={null}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Reset demo data")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("locks destructive controls while reset is pending", () => {
    render(
      <ResetDemoDialog
        open
        onOpenChange={() => undefined}
        locale="en"
        pending
        error={null}
        onConfirm={() => undefined}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Resetting demo data…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps cancellation available while a stale snapshot blocks confirmation", () => {
    render(
      <ResetDemoDialog
        open
        onOpenChange={() => undefined}
        locale="en"
        pending={false}
        disabled
        error={null}
        onConfirm={() => undefined}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Reset demo data" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
