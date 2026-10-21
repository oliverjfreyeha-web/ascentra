/**
 * Design rebuild D5 · Before and after screenshots of the Profile (My progress, /learn/progress), and the Iris primary
 * button's contrast there. Not part of CI: runs only with DESIGN_SHOTS=1 (DESIGN_SHOTS_TAG=before|after).
 */
import { writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { buildShell, openShell } from "./fixtures/shell-harness";
import { PROFILE_PROGRESS, TEST_TODAY } from "./fixtures/d4-data";

test.skip(!process.env.DESIGN_SHOTS, "Screenshots only on request (DESIGN_SHOTS=1).");
test.describe.configure({ mode: "serial" });
const TAG = process.env.DESIGN_SHOTS_TAG ?? "after";
const API = { "/api/v1/learn/progress": PROFILE_PROGRESS };
let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });
const out = (n: string) => `docs/design/shots/d5-${TAG}-${n}.jpg`;
const still = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));
const glasses = TAG === "before" ? ["frost"] : ["frost", "liquid"];

for (const theme of ["iris", "mono"]) for (const width of [1280, 390]) for (const glass of glasses) {
  test(`profile ${theme} ${glass} ${width}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(`${TEST_TODAY}T15:00:00Z`));
    await openShell(page, bundle, { path: "/learn/progress", role: "learner", width, api: API, saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
    await page.getByRole("heading", { name: "My progress" }).waitFor();
    await page.waitForTimeout(1600);
    await still(page);
    await page.screenshot({ path: out(`profile-${theme}-${glass}-${width}`), type: "jpeg", quality: 72, fullPage: TAG === "after" && width === 1280 });
  });
}

test("contrast of the primary button on the Profile", async ({ context }) => {
  test.skip(TAG !== "after", "Only after the restyle.");
  test.setTimeout(180000);
  const results: Record<string, unknown> = {};
  for (const [theme, glass, width] of [["iris", "frost", 1280], ["iris", "liquid", 1280], ["iris", "frost", 390], ["mono", "frost", 1280]] as const) {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(`${TEST_TODAY}T15:00:00Z`));
    await openShell(page, bundle, { path: "/learn/progress", role: "learner", width, api: API, saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
    const btn = page.locator(".pf .ds-btn--primary").first();
    await btn.waitFor();
    await still(page);
    const ink = await btn.evaluate((e) => getComputedStyle(e).color);
    await page.addStyleTag({ content: ".pf .ds-btn--primary, .pf .ds-btn--primary * { transition: none !important; } .pf .ds-btn--primary::before { opacity: 1 !important; }" });
    await btn.evaluate((e) => { const r = e.getBoundingClientRect(); const h = e as HTMLElement; h.style.setProperty("--mx", `${r.width * 0.55}px`); h.style.setProperty("--my", `${r.height / 2}px`); h.style.color = "transparent"; e.querySelectorAll("svg").forEach((s) => ((s as SVGElement).style.visibility = "hidden")); });
    await page.waitForTimeout(300);
    const samples: number[][] = [];
    for (let i = 0; i < 6; i++) {
      await btn.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(400);
      const png = (await btn.screenshot()).toString("base64");
      samples.push(await page.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
        const d = x.getImageData(Math.round(img.width * 0.2), Math.round(img.height * 0.25), Math.round(img.width * 0.6), Math.round(img.height * 0.5)).data, lum: number[] = [];
        const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        for (let k = 0; k < d.length; k += 4) lum.push(0.2126 * ch(d[k]) + 0.7152 * ch(d[k + 1]) + 0.0722 * ch(d[k + 2]));
        lum.sort((a, b) => a - b);
        return [lum[Math.floor(lum.length * 0.02)], lum[Math.floor(lum.length / 2)], lum[Math.floor(lum.length * 0.98)]];
      }, png));
      await page.waitForTimeout(1200);
    }
    const inkLum = await page.evaluate((c) => { const m = c.match(/\d+(\.\d+)?/g)!.map(Number); const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]); }, ink);
    const ratio = (a: number, b: number) => +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
    const steady = samples.slice(1);
    const lightest = Math.max(...steady.map((s) => s[2])), darkest = Math.min(...steady.map((s) => s[0]));
    const median = steady.map((s) => s[1]).sort()[Math.floor(steady.length / 2)];
    results[`${theme}/${glass}/${width}`] = { ink, worst: Math.min(ratio(inkLum, lightest), ratio(inkLum, darkest)), median: ratio(inkLum, median) };
    await page.close();
  }
  writeFileSync("docs/design/shots/d5-primary-button-contrast.json", `${JSON.stringify(results, null, 1)}\n`);
});
