import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ApiClientError } from "../../src/api/client";
import { EmptyState, ErrorState, FormError, LoadingState } from "../../src/components/ui/states";

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
});
