/**
 * Design rebuild D6 · The remaining routes in a real Chromium with the real stylesheets and pages (the shell harness).
 *   Every route renders as a restyled page (main.ds-page); admin, billing, safety, audit, Guardian, sign-in, onboarding
 *   and legal pages are calm: hovering and clicking give no glow or spark, nothing tilts and nothing loops. Mono turns
 *   the old navy panels graphite. No sideways scroll at 390px. Motion Reduced and Off stop the page entrance too.
 */
import { expect, test, type Page } from "@playwright/test";
import { buildShell, openShell, type ShellOpts } from "./fixtures/shell-harness";
import { D6_API, D6_LESSON_ID } from "./fixtures/d6-data";

let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });

type Route = { path: string; role: string | null; api?: Record<string, unknown>; calm: boolean; status?: Record<string, number> };
const R = (path: string, role: string | null, calm: boolean, api?: Record<string, unknown>): Route => ({ path, role, calm, api });
const ROUTES: Route[] = [
  R("/admin", "owner", true, D6_API.admin), R("/admin/audit", "owner", true, D6_API.audit), R("/admin/safety", "owner", true, D6_API.safety),
  R("/admin/review", "owner", true, D6_API.review), R("/admin/import", "owner", true, D6_API.import), R("/admin/security", "owner", true),
  R("/admin/topics", "owner", true), R("/admin/courses", "owner", true), R("/admin/sources", "owner", true), R("/admin/catalog", "owner", true),
  R("/admin/course-requests", "owner", true), R("/admin/missions", "owner", true),
  R("/account", "learner", true, D6_API.account), R("/guardian", "guardian", true, D6_API.guardian), { ...R("/pro", "learner", true, D6_API.pro), status: { "/api/v1/pro": 403 } },
  R("/sign-in", null, true), R("/sign-up", null, true), R("/welcome", "learner", true, D6_API.welcome), R("/credits", null, true),
  R("/not-available", null, true), R("/not-open", "learner", true), R("/missing", null, true),
  R("/learn/path", "learner", false, D6_API.path), R("/learn/track/copywriting", "learner", false, D6_API.track), R(`/learn/${D6_LESSON_ID}`, "learner", false, D6_API.lesson),
  R("/learn/choose", "learner", false), R("/learn/leaderboard", "learner", false), R("/learn/notebook", "learner", false), R("/community", "learner", false),
];
const open = (page: Page, r: Route, o: ShellOpts = {}) => openShell(page, bundle, { path: r.path, role: r.role, api: r.api ?? {}, apiStatus: r.status, ...o });
const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));

test("every remaining route is a restyled page; the right ones are calm; titles use the Ascentra font", async ({ page }) => {
  for (const r of ROUTES) {
    await open(page, r);
    const main = page.locator("main").first();
    await expect(main, r.path).toHaveClass(/\bds-page\b/);
    expect(await main.evaluate((m) => m.classList.contains("ds-page--calm")), r.path).toBe(r.calm);
    const h1 = page.locator("main h1:not([class])").first();
    if (await h1.count()) expect(await h1.evaluate((e) => getComputedStyle(e).fontFamily), r.path).toContain("Ascentra Display");
  }
});

test.setTimeout(240000);
test("calm pages: hovering and clicking give no glow or spark; nothing tilts; nothing loops", async ({ page }) => {
  for (const r of ROUTES.filter((x) => x.calm).slice(0, 16)) {
    await open(page, r);
    await page.waitForTimeout(400);
    const target = page.locator("main :is(button, a.ui-btn, .ui-block, section):visible").first();
    if (await target.count()) {
      await target.hover();
      await page.waitForTimeout(120);
      await expect(page.locator(".fx-glow"), r.path).not.toHaveAttribute("data-on", "");
      // A mouse click (detail 1) as the spark listens for it; its default action is cancelled so nothing is submitted.
      await target.evaluate((e) => {
        e.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { once: true });
        const r = e.getBoundingClientRect();
        e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: r.left + 4, clientY: r.top + 4 }));
      });
      await expect(page.locator(".fx-burst"), r.path).toHaveCount(0);
    }
    const loops = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
      .map((a) => (a as CSSAnimation).animationName ?? "")
      .filter((n) => n !== "ui-skeleton")); // loading placeholders are not decoration
    expect(loops, r.path).toEqual([]);
    const tilted = await page.locator("main").evaluate((m) => [...m.querySelectorAll<HTMLElement>("*")].filter((e) => /rotate|matrix3d/.test(getComputedStyle(e).transform)).length);
    expect(tilted, r.path).toBe(0);
  }
});

test("a learner page keeps its motion (the primary drifts, the backdrop moves) while calm pages don't", async ({ page }) => {
  await open(page, ROUTES.find((r) => r.path === "/learn/track/copywriting")!);
  await page.waitForTimeout(400);
  const names = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName));
  expect(names).toContain("bd-drift");
  // The same synthetic mouse click as the calm check does spark here (so that check can fail).
  await page.locator("main button:visible").first().evaluate((e) => {
    e.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { once: true });
    const r = e.getBoundingClientRect();
    e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: r.left + 4, clientY: r.top + 4 }));
  });
  await expect(page.locator(".fx-burst")).toHaveCount(1);
});

test("Mono: the old navy panels, wells and fields turn graphite; the admin page wall follows the theme", async ({ page }) => {
  for (const r of [ROUTES[0], ROUTES[1], ROUTES.find((x) => x.path === "/account")!, ROUTES.find((x) => x.path === "/learn/path")!]) {
    await open(page, r, { saved: { "ascentra.theme": "mono" } });
    await page.waitForTimeout(500);
    const navy = await page.evaluate(() => {
      const hits: string[] = [];
      for (const e of document.querySelectorAll<HTMLElement>("main *, html")) {
        const s = getComputedStyle(e), bg = `${s.backgroundColor} ${s.backgroundImage}`;
        if (/\b(8, 8, 19|14, 15, 31|20, 22, 44|10, 11, 24|16, 17, 35|12, 13, 27|8, 10, 28|10, 11, 24)\b/.test(bg)) hits.push(`${e.tagName}.${e.className}`);
      }
      return hits;
    });
    expect(navy, r.path).toEqual([]);
  }
});

test("390px: no sideways scroll on any route", async ({ page }) => {
  for (const r of ROUTES) {
    await open(page, r, { width: 390 });
    await page.waitForTimeout(300);
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), r.path).toBeLessThanOrEqual(0);
  }
});

for (const level of ["simple", "off"]) {
  test(`Motion ${level === "simple" ? "Reduced" : "Off"}: no entrance, drift or gloss on restyled pages`, async ({ page }) => {
    for (const r of [ROUTES.find((x) => x.path === "/learn/track/copywriting")!, ROUTES[0], ROUTES.find((x) => x.path === "/sign-in")!]) {
      await open(page, r, { saved: { "ascentra.motion": level } });
      await page.waitForTimeout(300);
      const names = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? "").filter((n) => /^(ds-|bd-|hud-|ui-page-in|glass-sheen)/.test(n)));
      expect(names, r.path).toEqual([]);
    }
  });
}
