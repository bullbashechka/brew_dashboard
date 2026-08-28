import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  ...(process.env.E2E_SYSTEM === "1"
    ? {}
    : { testIgnore: [/system\.spec\.ts$/, /performance\.spec\.ts$/] }),
  fullyParallel: process.env.E2E_SYSTEM !== "1",
  ...(process.env.E2E_SYSTEM === "1" ? { workers: 1 } : {}),
  forbidOnly: true,
  retries: 0,
  timeout: process.env.E2E_SYSTEM === "1" ? 300_000 : 60_000,
  globalTimeout: process.env.E2E_SYSTEM === "1" ? 1_800_000 : 600_000,
  reporter: "line",
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      process.env.E2E_SYSTEM === "1"
        ? "bun run ../backend/scripts/run-system-e2e.ts"
        : "bun run dev -- --mode e2e --host 127.0.0.1 --port 4173",
    reuseExistingServer: false,
    url: "http://127.0.0.1:4173",
    timeout: process.env.E2E_SYSTEM === "1" ? 180_000 : 60_000,
    ...(process.env.E2E_SYSTEM === "1"
      ? { gracefulShutdown: { signal: "SIGTERM" as const, timeout: 15_000 } }
      : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
});
