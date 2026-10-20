/**
 * Design rebuild D4 · Home and the Library in a real Chromium with the real stylesheets (no server, no secrets).
 *   Home (learner): Up next, the stats strip (rank tier and points, streak, sections) and the section cards, all from
 *   the progress API's real answer; only the section cards tilt; nothing when the read fails or for a Guardian.
 *   Library: the filter, the search, course cards with a status chip and a lessons-done bar; every lesson link kept;
 *   no income claims. Both: no horizontal overflow at 390px; Motion Reduced stops their motion; the old panels follow
 *   the theme (graphite in Mono).
 */
import { expect, test, type Page } from "@playwright/test";
import { buildShell, openShell } from "./fixtures/shell-harness";
import { COURSES, PROGRESS } from "./fixtures/d4-data";

let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });
const API = { "/api/v1/learn/courses": COURSES, "/api/v1/learn/progress": PROGRESS };

test("Home: Up next, real stats and the section cards; only the cards tilt", async ({ page }) => {
  await openShell(page, bundle, { path: "/", role: "learner", api: API });
  const next = page.locator(".home-next");
  await expect(next).toContainText("Up next");
  await expect(next).toContainText("Section 2 · Cold email");
  await expect(next.getByRole("link", { name: /Continue/ })).toHaveAttribute("href", "/learn");
  const stats = page.getByRole("definition");
  await expect(page.locator(".home-stats")).toContainText("Explorer");
  await expect(page.locator(".home-stats")).toContainText("14 points");
  await expect(page.locator(".home-stats")).toContainText("best 6");
  await expect(page.locator(".home-stats")).toContainText("of 5 done");
  await expect(stats).toHaveCount(3); // Rank, Streak, Sections (no Rounds: a module course)
  await expect(page.locator(".home-stats")).not.toContainText("#"); // the rank is a tier, never a position
  await expect(page.locator(".home-sec")).toHaveCount(5);
  await expect(page.locator(".home-sec .home-sec__chip")).toHaveText(["Done", "Open", "Open", "Locked", "Locked"]);
  await expect(page.locator(".home-sec").nth(3)).toContainText("Opens when you reach Builder.");
  expect(await page.locator(".home-sec.ds-tilt").count()).toBe(5);
  expect(await page.locator(".home-next.ds-tilt, .home-stat.ds-tilt, .app-hud.ds-tilt").count()).toBe(0);
  await expect(page.getByText("Ranks and streaks come from items you finish. Results vary. Nothing here promises income.")).toBeVisible();
});

test("Home: a Guardian never reads progress; a failed read shows nothing, and the account line stays", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/v1/learn/progress")) asked.push(r.url()); });
  await openShell(page, bundle, { path: "/", role: "guardian", api: API });
  await expect(page.getByText(/Signed in as Test person \(Guardian\)/)).toBeVisible();
  await expect(page.locator(".home-prog")).toHaveCount(0);
  expect(asked).toEqual([]);

  const p2 = await page.context().newPage();
  await openShell(p2, bundle, { path: "/", role: "learner", api: { "/api/v1/learn/courses": COURSES } }); // progress answers 404
  await expect(p2.getByText(/Signed in as Test person \(Learner\)/)).toBeVisible();
  await p2.waitForTimeout(500);
  await expect(p2.locator(".home-prog")).toHaveCount(0);
});

test("Library: filter, search, cards with status and progress, every lesson link kept, no income claims", async ({ page }) => {
  await openShell(page, bundle, { path: "/learn", role: "learner", api: API });
  const cards = page.locator(".lib-card");
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole("status").filter({ hasText: "3 courses." })).toBeVisible();
  await expect(cards.first()).toHaveClass(/lib-card--feat/);
  await expect(page.locator(".lib-chip")).toHaveText(["In progress", "Not started", "Done"]);
  await expect(page.getByRole("img", { name: "3 of 5 lessons done" })).toBeVisible();
  const group = page.getByRole("group", { name: "Show courses" });
  await group.getByRole("button", { name: "Taking" }).click();
  await expect(page.locator(".lib-card__title")).toHaveText(["Cold outreach", "Short-form video"]);
  await group.getByRole("button", { name: "Not started" }).click();
  await expect(page.locator(".lib-card__title")).toHaveText(["Copywriting"]);
  await group.getByRole("button", { name: "All" }).click();
  await page.getByRole("searchbox", { name: "Search courses and lessons" }).fill("hook");
  await expect(page.locator(".lib-card__title")).toHaveText(["Copywriting"]);
  await expect(page.getByRole("status").filter({ hasText: "1 of 3 courses match." })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search courses and lessons" }).fill("");
  // Every lesson link is still on the page (the featured card is open; the others open on request).
  const links = (c: number) => page.locator(".lib-card").nth(c).locator("a[href^='/learn/']");
  await expect(links(0)).toHaveCount(5);
  // Copywriting was the featured card while the search showed it alone, so it may already be open.
  const toggle = page.getByRole("button", { name: /lessons for Copywriting/ });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(links(1)).toHaveCount(3);
  await expect(links(1).first()).toHaveAttribute("href", "/learn/00000000-0000-4000-8000-0000000000b1");
  expect((await page.locator(".lib-card").allTextContents()).join(" ")).not.toMatch(/\b(earn|income|make money|\$\d)/i);
  expect(await page.locator(".lib-card.ds-tilt").count()).toBe(0);
});

for (const path of ["/", "/learn"]) {
  test(`phone (390px) ${path}: no horizontal overflow`, async ({ page }) => {
    await openShell(page, bundle, { path, role: "learner", api: API, width: 390 });
    await page.locator(path === "/" ? ".home-next" : ".lib-card").first().waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}

const motion = (page: Page) => page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? "").filter((n) => /^(ds-|lib-|hud-|bd-)/.test(n)));
for (const level of ["simple", "off"]) {
  test(`Motion ${level === "simple" ? "Reduced" : "Off"}: Home and the Library hold still`, async ({ page }) => {
    for (const path of ["/", "/learn"]) {
      await openShell(page, bundle, { path, role: "learner", api: API, saved: { "ascentra.motion": level } });
      await page.locator(path === "/" ? ".home-sec" : ".lib-card").first().waitFor();
      expect(await motion(page), path).toEqual([]);
      const card = page.locator(path === "/" ? ".home-sec" : ".lib-card").first();
      const b = (await card.boundingBox())!;
      await page.mouse.move(b.x + b.width - 10, b.y + 10);
      await page.waitForTimeout(150);
      expect(await card.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--tx"))).toBe("");
    }
  });
}

test("the old panels on these pages follow the theme: graphite in Mono, as before in Iris", async ({ page }) => {
  const surface = () => page.locator(".lib-card .ui-rows").first().evaluate((e) => getComputedStyle(e).getPropertyValue("--surface").trim());
  await openShell(page, bundle, { path: "/learn", role: "learner", api: API, saved: { "ascentra.theme": "iris" } });
  await page.locator(".lib-card .ui-rows").first().waitFor();
  const iris = await surface();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "mono"));
  const mono = await surface();
  expect(iris).not.toEqual(mono);
  expect(mono).not.toMatch(/14 15 31|8 10 28/);
});
