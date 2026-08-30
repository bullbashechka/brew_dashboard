import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ApiClientError } from "../../src/api/client";
import {
  ConflictState,
  EmptyState,
  ErrorState,
  FormError,
  LoadingState,
} from "../../src/components/ui/states";

afterEach(cleanup);

describe("shared loading, empty and error states", () => {
  it("exposes a live loading state and an explicit empty state", () => {
    render(
      <>
        <LoadingState locale="en" />
        <EmptyState locale="en">No rows yet</EmptyState>
      </>,
    );
    expect(screen.getByText("Loading…").closest("[aria-live='polite']")).toBeDefined();
    expect(screen.getByText("Loading…")).toBeDefined();
    expect(screen.getByText("No rows yet")).toBeDefined();
  });

  it("localizes safe API errors and surfaces only the request ID", () => {
    const error = new ApiClientError(
      "secret feedback must never be shown",
      500,
      "INTERNAL_ERROR",
      {},
      "123e4567-e89b-12d3-a456-426614174099",
    );
    render(
      <>
        <FormError locale="en" error={error} />
        <ErrorState locale="en" error={error} />
      </>,
    );
    expect(screen.getAllByRole("alert").length).toBe(2);
    expect(screen.getAllByText(/Something went wrong/).length).toBe(2);
    expect(screen.getAllByText(/123e4567-e89b-12d3-a456-426614174099/).length).toBe(2);
    expect(screen.queryByText(/secret feedback/)).toBeNull();
  });

  it("keeps a handled conflict to one alert with its recovery action", () => {
    const error = new ApiClientError(
      "secret conflict details",
      409,
      "CONFLICT",
      {},
      "123e4567-e89b-12d3-a456-426614174099",
    );
    render(
      <ConflictState locale="en" error={error} message="This record changed in another tab.">
        <button type="button">Use latest</button>
      </ConflictState>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("This record changed in another tab.");
    expect(screen.getByRole("alert").textContent).toContain("Support ID");
    expect(screen.getByRole("button", { name: "Use latest" })).toBeDefined();
    expect(screen.queryByText(/secret conflict details/)).toBeNull();
  });
});
