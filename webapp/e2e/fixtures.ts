import { expect as baseExpect, test as base } from "@playwright/test";

const ignoredRequestFailures = new Set(["net::ERR_ABORTED", "NS_BINDING_ABORTED"]);

type ExpectedHttpFailure = {
  method: string;
  url: string | RegExp;
  status: number;
  times: number;
  observed: number;
};

type BrowserFailureGuard = {
  allowHttpError: (
    input: Omit<ExpectedHttpFailure, "observed" | "times"> & { times?: number },
  ) => void;
};

const isIgnoredRequestFailure = (errorText: string | undefined) =>
  Boolean(errorText && ignoredRequestFailures.has(errorText));

/** Fail every browser test on unexpected client-side runtime failures. */
export const test = base.extend<{ browserFailureGuard: BrowserFailureGuard }>({
  browserFailureGuard: [
    async ({ page }, use, testInfo) => {
      const failures: string[] = [];
      const expectedHttpFailures: ExpectedHttpFailure[] = [];
      const guard: BrowserFailureGuard = {
        allowHttpError: (input) =>
          expectedHttpFailures.push({ ...input, times: input.times ?? 1, observed: 0 }),
      };
      const matchesExpectedHttpFailure = (method: string, url: string, status: number) => {
        const expected = expectedHttpFailures.find(
          (candidate) =>
            candidate.observed < candidate.times &&
            candidate.method === method &&
            candidate.status === status &&
            (typeof candidate.url === "string" ? candidate.url === url : candidate.url.test(url)),
        );
        if (expected) expected.observed += 1;
        return Boolean(expected);
      };
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (text.startsWith("Failed to load resource: the server responded with a status of"))
          return;
        failures.push(`console.error: ${text}`);
      });
      page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
      page.on("response", (response) => {
        if (response.status() < 400) return;
        const request = response.request();
        matchesExpectedHttpFailure(request.method(), response.url(), response.status());
      });
      page.on("requestfailed", (request) => {
        const errorText = request.failure()?.errorText;
        if (!isIgnoredRequestFailure(errorText)) {
          failures.push(`requestfailed: ${request.method()} ${request.url()} ${errorText ?? ""}`);
        }
      });

      await use(guard);

      for (const expected of expectedHttpFailures) {
        if (expected.observed !== expected.times) {
          failures.push(
            `expected HTTP failure count mismatch: ${expected.method} ${String(expected.url)} ${expected.status} expected ${expected.times}, observed ${expected.observed}`,
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
