import { defineConfig, devices } from "@playwright/test";

// R1: shared controls in a real browser, with the app's real stylesheets and no server (CI: "Component tests").
export default defineConfig({
  testDir: "e2e/components",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
