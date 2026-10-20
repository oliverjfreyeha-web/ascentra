/**
 * Design rebuild D8 · Visual baselines for Home, the Library (/learn), the Profile (/learn/progress), Account and Admin,
 * at 1280×900 and 390×844, in Iris + Frosted, Mono + Frosted and Iris + Liquid (Chromium). Real pages and stylesheets in
 * the shell harness, answered by the test fixtures (no sign-in, no live service, a fixed date). Stable by design:
 * animations are disabled for the capture, the page's own entrance and counters finish first, fonts are loaded, and the
 * WebGL globe (it turns, and depends on the GPU) is masked. The Review page has no route, so it isn't here.
 * Skipped unless run through playwright.visual.config.ts (npm run test:visual).
 */
import { expect, test } from "@playwright/test";
import { buildShell, openShell } from "../components/fixtures/shell-harness";
import { ROUTES } from "../components/fixtures/routes";
import { TEST_TODAY } from "../components/fixtures/d4-data";

test.skip(!process.env.VISUAL_BASELINES, "Visual baselines run only on request: npm run test:visual.");

const PAGES = [
  { name: "home", route: ROUTES.find((r) => r.path === "/" && r.role === "learner")! },
  { name: "library", route: ROUTES.find((r) => r.path === "/learn")! },
  { name: "profile", route: ROUTES.find((r) => r.path === "/learn/progress")! },
  { name: "account", route: ROUTES.find((r) => r.path === "/account")! },
  { name: "admin", route: ROUTES.find((r) => r.path === "/admin")! },
];
const LOOKS = [{ theme: "iris", glass: "frost" }, { theme: "mono", glass: "frost" }, { theme: "iris", glass: "liquid" }];
const SIZES = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];

let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });

for (const p of PAGES) for (const look of LOOKS) for (const size of SIZES) {
  const name = `${p.name}-${look.theme}-${look.glass}-${size.width}`;
  test(name, async ({ page }) => {
    await page.clock.setFixedTime(new Date(`${TEST_TODAY}T15:00:00Z`));
    await openShell(page, bundle, { path: p.route.path, role: p.route.role, api: p.route.api ?? {}, apiStatus: p.route.status, width: size.width, saved: { "ascentra.theme": look.theme, "ascentra.glass": look.glass } });
    await page.setViewportSize(size);
    await page.locator("main").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Let the data arrive, the entrance and reveals finish and the counters settle; keep the pointer out of the way.
    await page.mouse.move(2, size.height - 2);
    await page.waitForTimeout(1800);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));
    await expect(page).toHaveScreenshot(`${name}.png`, { mask: [page.locator(".pf-globe__canvas")] });
  });
}
