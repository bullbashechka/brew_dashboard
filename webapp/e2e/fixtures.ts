import { expect as baseExpect, test as base } from "@playwright/test";

const ignoredRequestFailures = new Set(["net::ERR_ABORTED", "NS_BINDING_ABORTED"]);

const isIgnoredRequestFailure = (errorText: string | undefined) =>
  Boolean(errorText && ignoredRequestFailures.has(errorText));

/** Fail every browser test on unexpected client-side runtime failures. */
export const test = base.extend<{ browserFailureGuard: void }>({
  browserFailureGuard: [
    async ({ page }, use, testInfo) => {
      const failures: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(`console.error: ${message.text()}`);
      });
      page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
      page.on("requestfailed", (request) => {
        const errorText = request.failure()?.errorText;
        if (!isIgnoredRequestFailure(errorText)) {
          failures.push(`requestfailed: ${request.method()} ${request.url()} ${errorText ?? ""}`);
        }
      });

      await use();

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
