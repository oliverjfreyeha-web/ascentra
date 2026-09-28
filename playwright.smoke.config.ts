import { defineConfig, devices } from "@playwright/test";

// Live smoke suite against production (see e2e/smoke/global-setup.ts). Test accounts only; never the Owner.
export default defineConfig({
  testDir: "e2e/smoke",
  globalSetup: "./e2e/smoke/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    // No traces: they would record request headers, including the cron secret.
    trace: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
