import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GuidedTour } from "../../src/components/guided-tour";

afterEach(cleanup);

describe("guided tour", () => {
  it("navigates through three steps and persists completion", async () => {
    const user = userEvent.setup();
    const routes: string[] = [];
    const states: string[] = [];
    render(
      <>
        <div data-tour="overview-filters" />
        <div data-tour="navigation-locations" />
        <div data-tour="feedback" />
        <GuidedTour
          locale="en"
          open
          onNavigate={async (route) => {
            routes.push(route);
          }}
          onPersist={async (state) => {
            states.push(state);
          }}
        />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish tour" }));

    await waitFor(() => expect(routes).toEqual(["/app/locations", "/app/inventory"]));
    expect(states).toEqual(["completed"]);
  });

  it("persists an explicit skip", async () => {
    const user = userEvent.setup();
    const states: string[] = [];
    render(
      <GuidedTour
        locale="en"
        open
        onNavigate={async () => undefined}
        onPersist={async (state) => {
          states.push(state);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(states).toEqual(["skipped"]));
  });
});
