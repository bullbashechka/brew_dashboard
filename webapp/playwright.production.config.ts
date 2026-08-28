import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_PRODUCTION_BASE_URL;
if (process.env.E2E_PRODUCTION !== "1" || !baseURL) {
  throw new Error("Production Playwright is available only through the guarded backend runner");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: /production\.spec\.ts$/u,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 300_000,
  globalTimeout: 900_000,
  reporter: "line",
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "production-chromium", use: { ...devices["Desktop Chrome"] } }],
});
