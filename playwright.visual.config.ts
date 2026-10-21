import { defineConfig, devices } from "@playwright/test";

/*
 * Design rebuild D8 · Visual baselines (Chromium, no server, no network, test fixtures only): `npm run test:visual`.
 * Update them on purpose with `npm run test:visual:update`. Kept apart from the component tests (their own folder and
 * config, so CI's component job never runs them), and the spec also skips itself unless this config turned it on.
 */
process.env.VISUAL_BASELINES = "1";

export default defineConfig({
  testDir: "e2e/visual",
  snapshotPathTemplate: "e2e/visual/baselines/{arg}{ext}",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  expect: { toHaveScreenshot: { maxDiffPixels: 200, threshold: 0.2, animations: "disabled", caret: "hide", scale: "css" } },
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
