/**
 * Design rebuild D3 · Screenshots for docs/design/shots/ and the primary button's contrast numbers. Not part of CI:
 * runs only with DESIGN_SHOTS=1 (npx playwright test -c playwright.components.config.ts design-shots).
 */
import { writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { buildShell, openShell } from "./fixtures/shell-harness";
test.skip(!process.env.DESIGN_SHOTS, "Screenshots only on request (DESIGN_SHOTS=1).");
test.describe.configure({ mode: "serial" });
let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });
const out = (n: string) => `docs/design/shots/${n}.jpg`;
const still = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));

for (const theme of ["iris", "mono"]) for (const width of [1280, 390]) {
  for (const glass of ["frost", "liquid"]) test(`account ${theme} ${glass} ${width}`, async ({ page }) => {
    await openShell(page, bundle, { path: "/account", role: "learner", width, saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
    await page.locator("#appearance").waitFor();
    await still(page);
    await page.locator("#appearance").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 90));
    await page.waitForTimeout(700);
    await page.screenshot({ path: out(`account-appearance-${theme}-${glass}-${width}`), type: "jpeg", quality: 72 });
  });
  test(`landing visitor ${theme} ${width}`, async ({ page }) => {
    await openShell(page, bundle, { path: "/", role: null, width, saved: { "ascentra.theme": theme } });
    await page.locator(".hall__title").waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out(`landing-hall-visitor-${theme}-${width}`), type: "jpeg", quality: 72 });
  });
  test(`learn ${theme} ${width}`, async ({ page }) => {
    await openShell(page, bundle, { path: "/learn", role: "owner", width, saved: { "ascentra.theme": theme } });
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link").first().waitFor();
    await still(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: out(`learn-hud-backdrop-${theme}-${width}`), type: "jpeg", quality: 72 });
  });
}

/* Iris primary button: white text over a translucent iridescent gradient. Measure the background behind the text at
   several moments of the drift (text hidden), as the WCAG ratio of white against the lightest and median pixels. */
test("contrast of the primary button", async ({ context }) => {
  test.setTimeout(180000);
  const results: Record<string, unknown> = {};
  for (const [theme, glass] of [["iris", "frost"], ["iris", "liquid"], ["mono", "frost"], ["mono", "liquid"]]) {
    const page = await context.newPage(); // a fresh page for each combination
    await openShell(page, bundle, { path: "/account", role: "learner", saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
    const btn = page.locator(".ap__glass .ds-btn--primary");
    await btn.waitFor();
    await still(page);
    const ink = await btn.evaluate((e) => getComputedStyle(e).color);
    await page.addStyleTag({ content: ".ap__glass .ds-btn--primary, .ap__glass .ds-btn--primary * { transition: none !important; }" });
    await btn.evaluate((e) => { (e as HTMLElement).style.color = "transparent"; e.querySelectorAll("svg").forEach((s) => ((s as SVGElement).style.visibility = "hidden")); });
    // The hover state, forced (the preview is inert): the specular highlight at full strength, aimed at the text.
    await page.addStyleTag({ content: ".ap__glass .ds-btn--primary::before { opacity: 1 !important; }" });
    await btn.evaluate((e) => { const r = e.getBoundingClientRect(); (e as HTMLElement).style.setProperty("--mx", `${r.width * 0.55}px`); (e as HTMLElement).style.setProperty("--my", `${r.height / 2}px`); });
    await page.waitForTimeout(500); // the text colour's own transition to transparent finishes first
    const samples: number[][] = [];
    for (let i = 0; i < 6; i++) {
      await btn.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })); // clear of the sticky HUD
      await page.waitForTimeout(400);
      const png = (await btn.screenshot()).toString("base64");
      samples.push(await page.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
        const d = x.getImageData(Math.round(img.width * 0.2), Math.round(img.height * 0.25), Math.round(img.width * 0.6), Math.round(img.height * 0.5)).data, lum: number[] = []; // the text band
        const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        for (let k = 0; k < d.length; k += 4) lum.push(0.2126 * ch(d[k]) + 0.7152 * ch(d[k + 1]) + 0.0722 * ch(d[k + 2]));
        lum.sort((a, b) => a - b);
        return [lum[Math.floor(lum.length * 0.02)], lum[Math.floor(lum.length / 2)], lum[Math.floor(lum.length * 0.98)]];
      }, png));
      await page.waitForTimeout(1500);
    }
    const inkLum = await page.evaluate((c) => { const m = c.match(/\d+(\.\d+)?/g)!.map(Number); const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]); }, ink);
    const ratio = (a: number, b: number) => +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
    // Steady state: the first sample after scrolling is dropped (in Liquid, headless Chromium repaints the backdrop
    // filter for a frame; reported separately in the D3 report).
    const steady = samples.slice(1);
    const lightest = Math.max(...steady.map((s) => s[2])), median = steady.map((s) => s[1]).sort()[Math.floor(steady.length / 2)], darkest = Math.min(...steady.map((s) => s[0]));
    results[`${theme}/${glass}`] = { ink, worst: Math.min(ratio(inkLum, lightest), ratio(inkLum, darkest)), median: ratio(inkLum, median), samples: samples.map((s) => s.map((v) => +v.toFixed(3))) };
  }
  writeFileSync("docs/design/shots/primary-button-contrast.json", `${JSON.stringify(results, null, 1)}\n`);
  console.log(JSON.stringify(results));
});
