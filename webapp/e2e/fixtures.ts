import { expect as baseExpect, test as base, type Page } from "@playwright/test";

const ignoredRequestFailures = new Set(["net::ERR_ABORTED", "NS_BINDING_ABORTED"]);

type ExpectedHttpFailure = {
  method: string;
  url: string | RegExp;
  status: number;
  minTimes: number;
  maxTimes: number;
  observed: number;
};

type BrowserFailureGuard = {
  allowHttpError: (
    input: Omit<ExpectedHttpFailure, "observed" | "minTimes" | "maxTimes"> & {
      times?: number;
      minTimes?: number;
      maxTimes?: number;
    },
  ) => void;
  watchPage: (page: Page) => void;
};

const isIgnoredRequestFailure = (errorText: string | undefined) =>
  Boolean(errorText && ignoredRequestFailures.has(errorText));

/** Fail every browser test on unexpected client-side runtime failures. */
export const test = base.extend<{ browserFailureGuard: BrowserFailureGuard }>({
  browserFailureGuard: [
    async ({ page }, use, testInfo) => {
      const failures: string[] = [];
      const expectedHttpFailures: ExpectedHttpFailure[] = [];
      const watchedPages = new WeakSet<Page>();
      const watchPage = (candidate: Page) => {
        if (watchedPages.has(candidate)) return;
        watchedPages.add(candidate);
        candidate.on("console", (message) => {
          if (message.type() !== "error") return;
          const text = message.text();
          // HTTP failures are reported by the response listener below. Keeping
          // this out of the console channel avoids reporting the same failure twice.
          if (text.startsWith("Failed to load resource: the server responded with a status of"))
            return;
          failures.push(`console.error: ${text}`);
        });
        candidate.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
        candidate.on("response", (response) => {
          if (response.status() < 400) return;
          const request = response.request();
          if (matchesExpectedHttpFailure(request.method(), response.url(), response.status()))
            return;
          failures.push(
            `unexpected HTTP ${response.status()}: ${request.method()} ${response.url()}`,
          );
        });
        candidate.on("requestfailed", (request) => {
          const errorText = request.failure()?.errorText;
          if (!isIgnoredRequestFailure(errorText)) {
            failures.push(`requestfailed: ${request.method()} ${request.url()} ${errorText ?? ""}`);
          }
        });
      };
      const guard: BrowserFailureGuard = {
        allowHttpError: ({ times, minTimes, maxTimes, ...input }) => {
          const minimum = minTimes ?? times ?? 1;
          const maximum = maxTimes ?? times ?? minimum;
          if (
            !Number.isInteger(minimum) ||
            !Number.isInteger(maximum) ||
            minimum < 0 ||
            maximum < minimum
          ) {
            throw new Error("Expected HTTP failure bounds must be non-negative integers");
          }
          expectedHttpFailures.push({
            ...input,
            minTimes: minimum,
            maxTimes: maximum,
            observed: 0,
          });
        },
        watchPage,
      };
      const matchesExpectedHttpFailure = (method: string, url: string, status: number) => {
        const expected = expectedHttpFailures.find(
          (candidate) =>
            candidate.observed < candidate.maxTimes &&
            candidate.method === method &&
            candidate.status === status &&
            (typeof candidate.url === "string" ? candidate.url === url : candidate.url.test(url)),
        );
        if (expected) expected.observed += 1;
        return Boolean(expected);
      };
      watchPage(page);

      // These are application-wide, fire-and-forget requests. Supplying a
      // successful baseline response lets each journey focus on the API it
      // owns, while any test that exercises either endpoint can still replace
      // this route with a stricter mock.
      await page.route("**/api/v1/events", (route) =>
        route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            data: { eventId: "123e4567-e89b-12d3-a456-426614174090" },
            meta: {},
            requestId: "123e4567-e89b-12d3-a456-426614174099",
          }),
        }),
      );
      await page.route("**/api/v1/feedback", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: null,
            meta: {},
            requestId: "123e4567-e89b-12d3-a456-426614174099",
          }),
        }),
      );

      await use(guard);

      for (const expected of expectedHttpFailures) {
        if (expected.observed < expected.minTimes || expected.observed > expected.maxTimes) {
          failures.push(
            `expected HTTP failure count mismatch: ${expected.method} ${String(expected.url)} ${expected.status} expected ${expected.minTimes}-${expected.maxTimes}, observed ${expected.observed}`,
          );
        }
      }

      if (failures.length) {
        baseExpect(
          failures,
          `Unexpected browser failures in ${testInfo.title}:\n${failures.join("\n")}`,
        ).toEqual([]);
      }
    },
    { auto: true },
  ],
});

export const expect = baseExpect;
export type { Page } from "@playwright/test";

export const openAppSection = async (page: Page, name: string) => {
  const navigationToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navigationToggle.isVisible()) await navigationToggle.click();
  await page.getByRole("link", { name, exact: true }).click();
};
