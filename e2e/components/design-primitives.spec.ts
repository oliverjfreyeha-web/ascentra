/**
 * Design rebuild D2 · Glass primitives in a real Chromium with the app's real stylesheets (no server, no secrets).
 *   Liquid: every <Glass> panel gets a lens (an SVG filter, --lg and data-lens); glass buttons and a region marked
 *   Frosted do not. Frosted: every filter and every inline value is removed. Lite mode drops the lens. At most 24
 *   filters exist. Unmounting leaves nothing behind. Nothing shifts the layout. Motion stops when data-reduced is "1".
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css",
  "app/styles/design.css", "app/styles/primitives.css"].map((f) => readFileSync(f, "utf8")).join("\n");
let bundle = "";
test.beforeAll(async () => {
  const out = await build({
    entryPoints: ["e2e/components/fixtures/design-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty" },
  });
  bundle = out.outputFiles[0].text;
});

async function mount(page: Page, o: { glass?: "liquid" | "frost"; lite?: "0" | "1"; reduced?: "0" | "1"; panels?: number } = {}) {
  const { glass = "liquid", lite = "0", reduced = "0", panels = 3 } = o;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("https://ascentra.test/", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en" data-theme="iris" data-glass="${glass}" data-lite="${lite}" data-reduced="${reduced}" data-motion="full"><head><title>Test</title><style>${CSS}</style>`
      + `<script>window.__shifts=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__shifts+=e.value}).observe({type:"layout-shift",buffered:true})</script>`
      + `</head><body><div id="root"></div></body></html>` }));
  await page.goto("https://ascentra.test/");
  await page.evaluate((n) => { (window as unknown as { __panels: number }).__panels = n; }, panels);
  await page.addScriptTag({ content: bundle });
  await page.getByTestId("panel-0").waitFor();
}
const filters = (page: Page) => page.locator("filter[id^='ui-lens-']").count();
const settle = (page: Page) => page.waitForTimeout(400); // the lens rescans 120 ms after a change
const setRoot = (page: Page, attr: string, v: string) => page.evaluate(([a, val]) => document.documentElement.setAttribute(a, val), [attr, v]);

test("Liquid: each glass panel gets a lens with the blur first; buttons and a Frosted region do not", async ({ page }) => {
  await mount(page);
  await settle(page);
  for (const id of ["hud", "panel-0", "panel-1", "panel-2", "tile"]) {
    const el = page.getByTestId(id);
    await expect(el, id).toHaveAttribute("data-lens", "");
    expect(await el.evaluate((e) => getComputedStyle(e).backdropFilter), id).toMatch(/^blur\(5px\) url\("?#ui-lens-\d+"?\)/);
  }
  expect(await filters(page)).toBe(5);
  await expect(page.locator(".ds-btn[data-lens]")).toHaveCount(0);
  await expect(page.getByTestId("frost-panel")).not.toHaveAttribute("data-lens", "");
  expect(await page.getByTestId("frost-panel").evaluate((e) => getComputedStyle(e).backdropFilter)).toMatch(/^blur\(22px\)/);
});

test("Frosted removes every lens and inline value; Liquid brings them back; Lite drops them", async ({ page }) => {
  await mount(page);
  await settle(page);
  expect(await filters(page)).toBeGreaterThan(0);
  await setRoot(page, "data-glass", "frost");
  await settle(page);
  expect(await filters(page)).toBe(0);
  await expect(page.locator("[data-lens]")).toHaveCount(0);
  expect(await page.locator(".ds-glass").evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.getPropertyValue("--lg")).length)).toBe(0);
  expect(await page.getByTestId("panel-0").evaluate((e) => getComputedStyle(e).backdropFilter)).toMatch(/^blur\(22px\) saturate\(1\.6\)/);

  await setRoot(page, "data-glass", "liquid");
  await settle(page);
  expect(await filters(page)).toBe(5);

  await setRoot(page, "data-lite", "1");
  await settle(page);
  expect(await filters(page)).toBe(0);
  expect(await page.getByTestId("panel-0").evaluate((e) => getComputedStyle(e).backdropFilter)).toMatch(/^blur\(10px\)/);
});

test("never more than 24 lens filters; the rest keep the plain Liquid fallback", async ({ page }) => {
  await mount(page, { panels: 40 });
  await settle(page);
  expect(await filters(page)).toBe(24);
  const last = page.getByTestId("panel-39");
  await expect(last).not.toHaveAttribute("data-lens", "");
  expect(await last.evaluate((e) => getComputedStyle(e).backdropFilter)).toMatch(/^blur\(9px\) saturate\(1\.7\)/);
});

test("unmounting removes every filter, the filter host and every inline value", async ({ page }) => {
  await mount(page);
  await settle(page);
  await page.evaluate(() => (window as unknown as { __unmount: () => void }).__unmount());
  expect(await filters(page)).toBe(0);
  expect(await page.locator("body > svg").count()).toBe(0);
});

test("no layout shift from the lens, the glass, the entrance or switching glass", async ({ page }) => {
  await mount(page);
  await page.waitForTimeout(1200); // entrance animations finish
  await setRoot(page, "data-glass", "frost");
  await settle(page);
  await setRoot(page, "data-glass", "liquid");
  await settle(page);
  await page.mouse.move(400, 200);
  await page.mouse.move(700, 260);
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as { __shifts: number }).__shifts)).toBe(0);
});

test("motion: the HUD's idle gloss runs; with data-reduced=1 nothing animates and the tile does not tilt", async ({ page }) => {
  await mount(page);
  // The rebuild's own animations (ds-*); the D3 page entrance (ui-page-in) predates the Motion setting.
  const running = () => page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName).filter((n) => n?.startsWith("ds-")));
  expect(await running()).toContain("ds-gloss");
  await setRoot(page, "data-reduced", "1");
  await page.waitForTimeout(50);
  expect(await running()).toEqual([]);
  const tile = page.getByTestId("tile");
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.waitForTimeout(300);
  expect(await tile.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--tx"))).toBe("");
});

test("pointer: one listener sets the rim angle and spotlight on glass, and tilts only the tile", async ({ page }) => {
  await mount(page);
  // Let the entrance finish (finite animations only; the HUD's idle gloss loops forever), so boxes stand still.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect?.getComputedTiming().iterations !== Infinity).map((x) => x.finished)));
  const tile = page.getByTestId("tile");
  const t = (await tile.boundingBox())!;
  // Well inside the rounded shape (a point in a 20px corner is outside it for hit-testing).
  await page.mouse.move(t.x + t.width * 0.9, t.y + t.height * 0.5);
  await page.waitForTimeout(100);
  expect(Number(await tile.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--tx")))).toBeGreaterThan(0.6);
  expect(await tile.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--ds-ang"))).toMatch(/deg$/);
  const hud = page.getByTestId("hud");
  const h = (await hud.boundingBox())!;
  await page.mouse.move(h.x + 10, h.y + 10);
  await page.waitForTimeout(100);
  expect(await hud.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--tx"))).toBe(""); // HUD never tilts
  expect(await hud.evaluate((e) => getComputedStyle(e).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/); // never rotated
  expect(await tile.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--tx"))).toBe(""); // left the tile: settles
});
