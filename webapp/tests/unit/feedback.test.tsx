import { afterEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Profile } from "@brew-dashboard/contracts";

import { FeedbackForm } from "../../src/components/feedback";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
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
  onboardingCompletedAt: "2026-08-26T10:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-08-26",
  demoDataRevision: 1,
  demoDataStale: false,
  tourState: "completed",
  expiresAt: null,
};
const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("feedback form", () => {
  it("loads saved values and submits only the contract fields", async () => {
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    globalThis.fetch = mock((path: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      requests.push({ path, ...(body ? { body } : {}) });
      const response =
        init?.method === "PUT"
          ? {
              data: {
                rating: 4,
                comment: "Useful dashboard",
                desiredFeatures: "POS import",
                version: 2,
                submittedAt: "2026-08-26T10:00:00.000Z",
                updatedAt: "2026-08-26T10:01:00.000Z",
              },
              meta: {},
              requestId,
            }
          : {
              data: {
                rating: 3,
                comment: "Existing note",
                desiredFeatures: "Existing feature",
                version: 1,
                submittedAt: "2026-08-25T10:00:00.000Z",
                updatedAt: "2026-08-25T10:00:00.000Z",
              },
              meta: {},
              requestId,
            };
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    }) as unknown as typeof fetch;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <FeedbackForm profile={profile} />
      </QueryClientProvider>,
    );

    await screen.findByDisplayValue("Existing feature");
    expect(screen.getByDisplayValue("Existing note")).toBeTruthy();
    await user.clear(screen.getByLabelText("What should we add for you to adopt this product?"));
    await user.type(
      screen.getByLabelText("What should we add for you to adopt this product?"),
      "POS import",
    );
    await user.clear(screen.getByLabelText("Anything else?"));
    await user.type(screen.getByLabelText("Anything else?"), "Useful dashboard");
    await user.click(screen.getByRole("button", { name: "Save feedback" }));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      path: "/api/v1/feedback",
      body: {
        rating: 3,
        comment: "Useful dashboard",
        desiredFeatures: "POS import",
        expectedVersion: 1,
      },
    });
  });

  it("refreshes the version before overwriting a feedback conflict", async () => {
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    let getCount = 0;
    let putCount = 0;
    globalThis.fetch = mock((path: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      requests.push({ path, ...(body ? { body } : {}) });
      if (init?.method !== "PUT") {
        getCount += 1;
        const version = getCount === 1 ? 1 : 2;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                rating: 3,
                comment: version === 1 ? "Existing note" : "Newer note",
                desiredFeatures: version === 1 ? "Existing feature" : "Newer feature",
                version,
                submittedAt: "2026-08-25T10:00:00.000Z",
                updatedAt: "2026-08-25T10:00:00.000Z",
              },
              meta: {},
              requestId,
            }),
            { status: 200 },
          ),
        );
      }

      putCount += 1;
      if (putCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "CONFLICT", message: "conflict", fields: {} },
              requestId,
            }),
            { status: 409 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              rating: 3,
              comment: "Draft note",
              desiredFeatures: "Draft feature",
              version: 3,
              submittedAt: "2026-08-25T10:00:00.000Z",
              updatedAt: "2026-08-27T10:00:00.000Z",
            },
            meta: {},
            requestId,
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <FeedbackForm profile={profile} />
      </QueryClientProvider>,
    );

    await screen.findByDisplayValue("Existing feature");
    await user.clear(screen.getByLabelText("What should we add for you to adopt this product?"));
    await user.type(
      screen.getByLabelText("What should we add for you to adopt this product?"),
      "Draft feature",
    );
    await user.clear(screen.getByLabelText("Anything else?"));
    await user.type(screen.getByLabelText("Anything else?"), "Draft note");
    await user.click(screen.getByRole("button", { name: "Save feedback" }));

    await screen.findByText(
      "Feedback changed in another tab. Reload it or overwrite with your answers.",
    );
    await user.click(screen.getByRole("button", { name: "Overwrite with my price" }));

    await waitFor(() => expect(putCount).toBe(2));
    expect(requests[3]).toMatchObject({
      path: "/api/v1/feedback",
      body: {
        rating: 3,
        comment: "Draft note",
        desiredFeatures: "Draft feature",
        expectedVersion: 2,
      },
    });
  });
});
