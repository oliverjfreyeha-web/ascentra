import { defineConfig, devices } from "@playwright/test";

// Ported journeys: local build + local database + the Clerk DEVELOPMENT instance (see e2e/journeys/global-setup.ts).
export default defineConfig({
  testDir: "e2e/journeys",
  globalSetup: "./e2e/journeys/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
