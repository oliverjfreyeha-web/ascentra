/**
 * Design rebuild D3 · The app shell in a real Chromium with the real stylesheets (no server, no secrets).
 *   HUD: the role's tabs (the same links Home's account line gives), the unchanged staff navigation (Admin for the Owner
 *   and staff only), Account and Appearance buttons; none on visitor and sign-in screens; hidden on the landing until
 *   signed in (the Hall is the visitor's hero). Backdrop: one fixed layer; Iris floor, Mono light; still when reduced;
 *   old saved scenes load cleanly and no scene photo is fetched. Phones: no horizontal overflow, compact HUD.
 *   Account → Appearance writes through the preferences module. Cursor effects only on cards and buttons, off when
 *   reduced. No layout shift while the account loads.
 */
import { expect, test, type Page } from "@playwright/test";
import { buildShell, openShell } from "./fixtures/shell-harness";
import { COURSES, PROGRESS } from "./fixtures/d4-data";

let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });
const hud = (page: Page) => page.locator("header.app-hud");
const tabs = (page: Page) => page.getByRole("navigation", { name: "Primary" }).getByRole("link");

test("learner: Home, Learn, My path and Progress; the current tab is marked; no Admin link", async ({ page }) => {
  await openShell(page, bundle, { path: "/learn", role: "learner" });
  await expect(tabs(page)).toHaveText(["Home", "Learn", "My path", "Progress"]);
  await expect(tabs(page).filter({ hasText: "Learn" }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Staff" })).toHaveCount(0);
  await expect(hud(page).getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  await expect(hud(page).getByRole("link", { name: "Appearance settings" })).toHaveAttribute("href", "/account#appearance");
  await expect(hud(page).getByRole("link", { name: "ASCENTRA home" })).toHaveAttribute("href", "/");
});

test("guardian: Home and the Guardian Center only", async ({ page }) => {
  await openShell(page, bundle, { path: "/guardian", role: "guardian" });
  await expect(tabs(page)).toHaveText(["Home", "Guardian Center"]);
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
});

test("Owner: the staff navigation's Admin link sits in the HUD, unchanged", async ({ page }) => {
  await openShell(page, bundle, { path: "/learn", role: "owner" });
  await expect(hud(page).getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Admin", exact: true })).toHaveAttribute("href", "/admin");
});

test("visitor on the landing: the Hall is the hero with its own navigation; no HUD", async ({ page }) => {
  await openShell(page, bundle, { path: "/", role: null });
  await expect(page.locator("#hall")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(hud(page)).toBeHidden();
});

test("signed in on the landing: Home with the HUD, not the Hall", async ({ page }) => {
  await openShell(page, bundle, { path: "/", role: "learner" });
  await expect(hud(page)).toBeVisible();
  await expect(page.locator("[data-landing]")).toHaveAttribute("data-auth", "in");
  await expect(page.locator("#hall")).toBeHidden();
});

test("sign-in screens keep their own layout: no HUD", async ({ page }) => {
  await openShell(page, bundle, { path: "/sign-in", role: null });
  await expect(page.locator("header.app-hud")).toHaveCount(0);
});

test("backdrop: one fixed layer; Iris has the floor, Mono the light; old saved scenes load cleanly with no scene photo", async ({ page }) => {
  const photos: string[] = [];
  page.on("request", (r) => { if (/\/env\//.test(r.url())) photos.push(r.url()); });
  await openShell(page, bundle, { path: "/learn", saved: { "ascentra.scene": "reef", "ascentra.glass": "liquid", "ascentra.motion": "full" } });
  await expect(page.locator(".bd")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-scene"))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-glass"))).toBe("liquid");
  await expect(page.locator(".bd__floor")).toBeVisible();
  await expect(page.locator(".bd__light")).toBeHidden();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "mono"));
  await expect(page.locator(".bd__floor")).toBeHidden();
  await expect(page.locator(".bd__light")).toBeVisible();
  expect(await page.locator(".bd__core").evaluate((e) => { const r = e.getBoundingClientRect(); return [Math.round((r.left + r.width / 2) / innerWidth * 100), Math.round((r.top + r.height / 2) / innerHeight * 100)]; })).toEqual([68, 13]); // ~68% across, 13vh down
  expect(photos).toEqual([]);
});

test("backdrop: Motion Reduced stops drift, dust and parallax", async ({ page }) => {
  await openShell(page, bundle, { path: "/learn", saved: { "ascentra.motion": "simple" } });
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-reduced"))).toBe("1");
  const bdAnims = () => page.evaluate(() => document.getAnimations().filter((a) => ((a as CSSAnimation).animationName ?? "").startsWith("bd-")).length);
  expect(await bdAnims()).toBe(0);
  await page.mouse.move(100, 100);
  await page.mouse.move(900, 600);
  await page.waitForTimeout(150);
  expect(await page.locator(".bd").evaluate((e) => (e as HTMLElement).style.getPropertyValue("--px"))).not.toMatch(/^-?0\.[1-9]|^-?1/);
});

for (const path of ["/learn", "/account", "/"]) {
  test(`phone (390px) ${path}: no horizontal overflow; the HUD shows the emblem and icon tabs`, async ({ page }) => {
    await openShell(page, bundle, { path, role: "learner", width: 390 });
    await expect(hud(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator(".app-hud__word")).toBeHidden();
    const box = (await hud(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
}

test("phone (390px) visitor landing: the Hall's words sit on a dark scrim and fit the screen", async ({ page }) => {
  await openShell(page, bundle, { path: "/", role: null, width: 390 });
  await expect(page.locator(".hall__title")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await page.locator(".hall__scrim").evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/gradient/);
});

test("Account → Appearance writes through the preferences module (Reduced is stored as simple; sound in the sound preference)", async ({ page }) => {
  await openShell(page, bundle, { path: "/account", role: "learner" });
  const group = (name: string) => page.getByRole("group", { name, exact: true });
  await group("Theme").getByRole("button", { name: "Mono" }).click();
  expect(await page.evaluate(() => [document.documentElement.getAttribute("data-theme"), localStorage.getItem("ascentra.theme")])).toEqual(["mono", "mono"]);
  await group("Glass").getByRole("button", { name: "Liquid" }).click();
  expect(await page.evaluate(() => localStorage.getItem("ascentra.glass"))).toBe("liquid");
  await group("Motion").getByRole("button", { name: "Reduced" }).click();
  expect(await page.evaluate(() => [localStorage.getItem("ascentra.motion"), document.documentElement.getAttribute("data-reduced")])).toEqual(["simple", "1"]);
  await group("Effects").getByRole("button", { name: "Always full" }).click();
  expect(await page.evaluate(() => localStorage.getItem("ascentra.effects"))).toBe("full");
  await group("Interface sounds").getByRole("button", { name: "On" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ascentra.sound") ?? "{}").effects)).toBe(true);
  await expect(page.getByRole("group", { name: "Scene" })).toHaveCount(0);
});

// D6: moved from Account to the Library, because Account (billing, privacy, devices) is now a calm page with no glow
// or spark (checked at the end).
test("cursor glow over buttons only, and a click spark; neither with Motion Reduced, nor on a calm page", async ({ page }) => {
  const api = { "/api/v1/learn/courses": COURSES, "/api/v1/learn/progress": PROGRESS };
  await openShell(page, bundle, { path: "/learn", role: "learner", api });
  const btn = page.getByRole("button", { name: "Not started" });
  await btn.hover();
  await expect(page.locator(".fx-glow")).toHaveAttribute("data-on", "");
  await page.mouse.move(5, 400);
  await expect(page.locator(".fx-glow")).not.toHaveAttribute("data-on", "");
  await btn.click();
  await expect(page.locator(".fx-burst")).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(page.locator(".fx-burst")).toHaveCount(0);
  await openShell(page, bundle, { path: "/learn", role: "learner", api, saved: { "ascentra.motion": "simple" } });
  await page.getByRole("button", { name: "Not started" }).click();
  await expect(page.locator(".fx-burst")).toHaveCount(0);
  await expect(page.locator(".fx-glow")).toBeHidden();
  await openShell(page, bundle, { path: "/account", role: "learner" });
  const iris = page.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Iris" });
  await iris.hover();
  await page.waitForTimeout(150);
  await expect(page.locator(".fx-glow")).not.toHaveAttribute("data-on", "");
  await iris.click();
  await expect(page.locator(".fx-burst")).toHaveCount(0);
});

test("no layout shift from the HUD while the account loads into it (the frame is there from the start)", async ({ page }) => {
  await openShell(page, bundle, { path: "/learn", role: "owner", meDelayMs: 1500 });
  await expect(hud(page)).toBeVisible();
  // The page's own entrance (a transform, not a shift) finishes first, so boxes stand still.
  await page.evaluate(() => Promise.all(document.querySelector("main")!.getAnimations().map((a) => a.finished)));
  await expect(tabs(page)).toHaveCount(0); // the account isn't known yet
  const before = { hud: await hud(page).boundingBox(), h1: await page.locator("main h1").boundingBox() };
  await expect(tabs(page)).toHaveCount(4);
  await expect(page.getByRole("navigation", { name: "Staff" })).toBeVisible();
  expect(await hud(page).boundingBox()).toEqual(before.hud);
  expect(await page.locator("main h1").boundingBox()).toEqual(before.h1);
});
