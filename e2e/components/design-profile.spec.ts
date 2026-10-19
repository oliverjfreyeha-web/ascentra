/**
 * Design rebuild D5 · The Profile dashboard (My progress) in a real Chromium with the real stylesheets.
 *   Real data only: six widgets with a full answer; a widget whose data is missing is not shown (and the chooser says so);
 *   never trophies, coins, badges, Next reward, Recent activity or a Review deck; never a position like "#12 of 1,240";
 *   never minutes. The activity grid's Year view shows 365 days. The chooser and X buttons hide widgets and the choice is
 *   saved. Widgets never tilt. Phone: one column, and the tree scrolls in its own box. Motion Reduced stops the motion.
 *   The globe: WebGL where effects are full, the poster in Lite mode.
 */
import { expect, test, type Page } from "@playwright/test";
import { buildShell, openShell, type ShellOpts } from "./fixtures/shell-harness";
import { PROFILE_PROGRESS, TEST_TODAY } from "./fixtures/d4-data";

let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });
async function open(page: Page, progress: unknown = PROFILE_PROGRESS, o: ShellOpts = {}) {
  await page.clock.setFixedTime(new Date(`${TEST_TODAY}T15:00:00Z`));
  await openShell(page, bundle, { path: "/learn/progress", role: "learner", api: { "/api/v1/learn/progress": progress }, ...o });
  await page.getByRole("heading", { name: "Your dashboard" }).waitFor();
}
const widgetTitles = (page: Page) => page.locator(".pf-w__title").allTextContents();

test("all six widgets from real data; nothing hidden-only is built; no positions, no minutes", async ({ page }) => {
  await open(page);
  expect(await widgetTitles(page)).toEqual(["Progress globe", "Streak", "Points", "Rank", "Activity", "Course map"]);
  const text = (await page.locator(".pf").textContent()) ?? "";
  expect(text).not.toMatch(/trophy|trophies|coin|badge|next reward|recent activity|review deck|demo|simulated/i);
  expect(text).not.toMatch(/#\d+|\bof [\d,]{3,}\b(?! items)/);
  expect(text).not.toMatch(/\bmin(ute)?s?\b/);
  await expect(page.locator(".pf-w--globe")).toContainText("32%");
  await expect(page.locator(".pf-w--globe")).toContainText("9 of 28 items done across your courses");
  await expect(page.locator(".pf-w--streak")).toContainText("best 6");
  await expect(page.getByRole("list", { name: /Last 7 days: items finished on 4 of them/ })).toBeVisible();
  await expect(page.locator(".pf-w--points")).toContainText("+4 today");
  await expect(page.locator(".pf-w--rank")).toContainText("Explorer");
  await expect(page.locator(".pf-w--rank")).toContainText("Next: Builder, 11 more points");
  await expect(page.locator(".pf-w--rank").getByRole("link", { name: "Open the leaderboard" })).toHaveAttribute("href", "/learn/leaderboard");
  await expect(page.getByRole("list", { name: "Rank tiers, lowest to highest" }).getByRole("listitem")).toHaveCount(10);
  expect(await page.locator(".pf .ds-tilt").count()).toBe(0); // widgets never tilt
});

test("a widget whose data is missing is not shown, and the chooser says why", async ({ page }) => {
  const empty = { ...PROFILE_PROGRESS, courses: [], skills: [], pointsByDay: [], rank: { index: 1, name: "Initiate", points: 0, next: { name: "Explorer", needs: 10 } }, streak: { current: 0, longest: 0 } };
  await open(page, empty);
  expect(await widgetTitles(page)).toEqual(["Streak", "Points", "Rank"]);
  await expect(page.locator(".pf-w--points")).toContainText("Finish an item to start your points history.");
  await page.getByRole("button", { name: "Choose widgets" }).click();
  const menu = page.getByRole("group", { name: "Widgets" });
  for (const w of ["Progress globe", "Activity", "Course map"]) {
    await expect(menu.getByRole("checkbox", { name: new RegExp(w) })).toBeDisabled();
    await expect(menu.getByText(new RegExp(`${w} · no data yet`))).toBeVisible();
  }
});

test("activity grid: Week, Month and Year (365 days) in points per day, with labels, a hover line and a legend", async ({ page }) => {
  await open(page);
  const act = page.locator(".pf-w--activity");
  await expect(act.locator(".pf-ac[role='img']")).toHaveCount(7);
  await act.getByRole("button", { name: "Month" }).click();
  await expect(act.locator(".pf-ac[role='img']")).toHaveCount(19); // Oct 1 to Oct 19
  await act.getByRole("button", { name: "Year" }).click();
  await expect(act.locator(".pf-ag__ygrid .pf-ac[role='img']")).toHaveCount(365);
  const today = act.locator(".pf-ac--today");
  await expect(today).toHaveAttribute("aria-label", /Oct 19 · 4 points · Steady/);
  await today.hover();
  await expect(act.locator(".pf-act__tip")).toHaveText(/Oct 19 · 4 points · Steady/);
  await expect(act.locator(".pf-act__legend li")).toHaveText([/Rest/, /Missed/, /Short/, /Steady/, /Focused/, /Grind/]);
  await expect(act).not.toContainText(/\bmin\b|minutes/);
});

test("chooser and X buttons hide widgets; the choice is saved in this browser and survives a reload", async ({ page }) => {
  await open(page);
  const x = page.getByRole("button", { name: "Hide Streak" });
  expect(await x.evaluate((e) => getComputedStyle(e).opacity)).toBe("0"); // shown on hover or focus
  await page.locator(".pf-w--streak").hover();
  await expect.poll(() => x.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  await x.click();
  expect(await widgetTitles(page)).not.toContain("Streak");
  await page.getByRole("button", { name: "Choose widgets" }).click();
  await page.getByRole("group", { name: "Widgets" }).getByRole("checkbox", { name: /Course map/ }).uncheck();
  expect(await widgetTitles(page)).toEqual(["Progress globe", "Points", "Rank", "Activity"]);
  expect(await page.evaluate(() => localStorage.getItem("ascentra.profileWidgets"))).toBe('["streak","map"]');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Widgets" })).toHaveCount(0);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.getByRole("heading", { name: "Your dashboard" }).waitFor();
  await expect.poll(() => widgetTitles(page)).toEqual(["Progress globe", "Points", "Rank", "Activity"]);
});

test("course map: the real sections with their states; open ones link to the course; locked ones say why", async ({ page }) => {
  await open(page);
  const map = page.locator(".pf-w--map");
  await expect(map.locator(".pf-branch")).toHaveCount(2);
  await expect(map.locator(".pf-node--done")).toHaveCount(2);
  await expect(map.locator(".pf-node--now")).toHaveCount(2);
  await expect(map.getByRole("link", { name: /Open Cold outreach: section 2, Cold email, you are here/ })).toHaveAttribute("href", "/learn");
  await expect(map.getByRole("link", { name: /Open Copywriting: section 2, Offers, you are here/ })).toHaveAttribute("href", "/learn/track/copywriting");
  await expect(map.getByRole("img", { name: /Cold outreach: section 4, Warming it up, locked\. Opens when you reach Builder\./ })).toBeVisible();
});

test("phone (390px): one column, no page overflow; the tree scrolls inside its own box; the globe is the poster (Lite)", async ({ page }) => {
  await open(page, PROFILE_PROGRESS, { width: 390 });
  // The entrance (rise and a slight scale) finishes first, so the boxes stand still.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect?.getComputedTiming().iterations !== Infinity).map((x) => x.finished.catch(() => null))));
  const xs = await page.locator(".pf-w").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const scroll = page.locator(".pf-map__scroll");
  expect(await scroll.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-lite"))).toBe("1");
  await expect(page.locator(".pf-globe__poster")).toBeVisible();
  await expect(page.locator(".pf-globe__canvas")).toHaveCount(0);
});

test("desktop: the globe's WebGL part loads (cobe) over the poster", async ({ page }) => {
  await open(page);
  await expect(page.locator(".pf-globe__canvas")).toHaveCount(1);
  await expect(page.locator(".pf-globe__poster")).toHaveCount(1);
});

for (const level of ["simple", "off"]) {
  test(`Motion ${level === "simple" ? "Reduced" : "Off"}: the dashboard holds still`, async ({ page }) => {
    await open(page, PROFILE_PROGRESS, { saved: { "ascentra.motion": level } });
    await page.waitForTimeout(300);
    const names = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? "").filter((n) => /^(ds-|pf-|bd-|hud-)/.test(n)));
    expect(names).toEqual([]);
  });
}
