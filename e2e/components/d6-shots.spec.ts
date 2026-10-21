/**
 * Design rebuild D6 · Before and after screenshots of the key remaining routes, and the Iris primary button's contrast on
 * them. Not part of CI: runs only with DESIGN_SHOTS=1 (DESIGN_SHOTS_TAG=before|after).
 */
import { writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { buildShell, openShell } from "./fixtures/shell-harness";
import { D6_API, D6_LESSON_ID } from "./fixtures/d6-data";

test.skip(!process.env.DESIGN_SHOTS, "Screenshots only on request (DESIGN_SHOTS=1).");
test.describe.configure({ mode: "serial" });
const TAG = process.env.DESIGN_SHOTS_TAG ?? "after";
let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });
const out = (n: string) => `docs/design/shots/d6-${TAG}-${n}.jpg`;
const still = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));

type Key = { name: string; path: string; role: string | null; api?: Record<string, unknown>; phone?: boolean; liquid?: boolean };
const KEYS: Key[] = [
  { name: "admin", path: "/admin", role: "owner", api: D6_API.admin, phone: true, liquid: true },
  { name: "audit", path: "/admin/audit", role: "owner", api: D6_API.audit, phone: true },
  { name: "safety", path: "/admin/safety", role: "owner", api: D6_API.safety },
  { name: "owner-review", path: "/admin/review", role: "owner", api: D6_API.review },
  { name: "import", path: "/admin/import", role: "owner", api: D6_API.import },
  { name: "account-billing", path: "/account", role: "learner", api: D6_API.account, phone: true },
  { name: "guardian", path: "/guardian", role: "guardian", api: D6_API.guardian, phone: true, liquid: true },
  { name: "sign-in", path: "/sign-in", role: null, phone: true, liquid: true },
  { name: "welcome", path: "/welcome", role: "learner", api: D6_API.welcome },
  { name: "section", path: `/learn/${D6_LESSON_ID}`, role: "learner", api: D6_API.lesson, phone: true, liquid: true },
  { name: "track", path: "/learn/track/copywriting", role: "learner", api: D6_API.track },
  { name: "path", path: "/learn/path", role: "learner", api: D6_API.path },
];

async function shoot(page: Page, k: Key, theme: string, glass: string, width: number) {
  await page.clock.setFixedTime(new Date("2026-10-19T15:00:00Z"));
  await openShell(page, bundle, { path: k.path, role: k.role, width, api: k.api ?? {}, saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
  await page.waitForTimeout(1400);
  await still(page);
  await page.screenshot({ path: out(`${k.name}-${theme}-${glass}-${width}`), type: "jpeg", quality: 64 });
}

for (const k of KEYS) for (const theme of ["iris", "mono"]) {
  test(`${k.name} ${theme}`, async ({ page }) => {
    await shoot(page, k, theme, "frost", 1280);
    if (TAG === "after" && k.phone) await shoot(page, k, theme, "frost", 390);
    if (TAG === "after" && k.liquid) await shoot(page, k, theme, "liquid", 1280);
  });
}

// The Iris primary on the calm sign-in card (a still primary) and on a Section page (the drifting one).
test("contrast of the primary button", async ({ context }) => {
  test.skip(TAG !== "after", "Only after the restyle.");
  test.setTimeout(240000);
  const results: Record<string, unknown> = {};
  const cases = [["sign-in", "iris", "frost", 1280], ["sign-in", "iris", "liquid", 1280], ["sign-in", "iris", "frost", 390], ["sign-in", "mono", "frost", 1280],
    ["section", "iris", "frost", 1280], ["section", "iris", "liquid", 1280], ["section", "iris", "frost", 390]] as const;
  for (const [name, theme, glass, width] of cases) {
    const k = KEYS.find((x) => x.name === name)!;
    const page = await context.newPage();
    await openShell(page, bundle, { path: k.path, role: k.role, width, api: k.api ?? {}, saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
    const btn = page.locator("main :is(button.primary, .ui-btn--primary)").first();
    try { await btn.waitFor({ timeout: 5000 }); } catch { results[`${name}/${theme}/${glass}/${width}`] = "no primary button on this page"; await page.close(); continue; }
    await still(page);
    const ink = await btn.evaluate((e) => getComputedStyle(e).color);
    await btn.evaluate((e) => { (e as HTMLElement).style.transition = "none"; (e as HTMLElement).style.color = "transparent"; e.querySelectorAll("svg").forEach((s) => ((s as SVGElement).style.visibility = "hidden")); });
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
    results[`${name}/${theme}/${glass}/${width}`] = { ink, worst: Math.min(ratio(inkLum, lightest), ratio(inkLum, darkest)), median: ratio(inkLum, median) };
    await page.close();
  }
  writeFileSync("docs/design/shots/d6-primary-button-contrast.json", `${JSON.stringify(results, null, 1)}\n`);
});
