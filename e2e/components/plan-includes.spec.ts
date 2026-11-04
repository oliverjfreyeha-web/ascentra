/**
 * Account → Billing shows what each plan opens for learning (lib/plan-includes.ts, sent by GET /api/v1/billing), and
 * the Access label says "Free trial", not "Trial (Basic features)". A learner on the trial sees what the trial
 * includes; someone choosing a plan sees each plan's list, and for Basic what its free trial includes. Real component,
 * real stylesheets, axe at desktop and phone width.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { PLAN_INCLUDES } from "../../lib/plan-includes";

const CSS = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css"]
  .map((f) => readFileSync(f, "utf8")).join("\n");
const AXE = readFileSync(resolve("node_modules/axe-core/axe.min.js"), "utf8");
let bundle = "";
test.beforeAll(async () => {
  const stubs = resolve("e2e/components/fixtures/c2-stubs.tsx");
  const out = await build({
    entryPoints: ["e2e/components/fixtures/billing-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", loader: { ".css": "empty" },
    alias: { "@clerk/nextjs": stubs, "next/link": stubs, "next/navigation": stubs },
  });
  bundle = out.outputFiles[0].text;
});

const PLANS = [{ key: "basic", name: "Basic", cents: 2000 }, { key: "pro", name: "Pro", cents: 5000 }];
const TERMS = { title: "Automatic Renewal Terms", version: "v0.1", body: "Test renewal terms." };
const TRIAL = {
  configured: true, canSubscribe: true, canManage: true, tier: "trial", source: "subscription",
  subscription: { plan: "trial", status: "trialing", trialEndsAt: "2026-11-18T15:00:00.000Z", nextChargeAt: "2026-11-18T15:00:00.000Z", nextChargeCents: 2000, accessUntil: null },
  trialEligible: false, trialDays: 14, trialWouldEndAt: "2026-11-18T15:00:00.000Z", plans: PLANS, terms: TERMS, includes: PLAN_INCLUDES,
};
const NEW = { ...TRIAL, tier: "none", source: "none", subscription: null, trialEligible: true };

async function mount(page: Page, billing: unknown, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(billing) }));
  await page.route("https://ascentra.test/", (route) => route.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en" data-glass="liquid" data-motion="off"><head><title>Test</title><style>${CSS}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("https://ascentra.test/");
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
}
async function axe(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (n: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown }[] }[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes[0]?.target)}`);
  });
}

test("a learner on the trial: Access says Free trial, and the page lists what the trial includes", async ({ page }) => {
  await mount(page, TRIAL);
  await expect(page.getByText("Free trial", { exact: true })).toBeVisible();
  await expect(page.getByText(/Basic features/)).toHaveCount(0);
  const list = page.getByRole("list", { name: "What your plan includes" });
  await expect(list.getByRole("listitem")).toHaveText(PLAN_INCLUDES.trial);
  await expect(list).toContainText("Skill tracks: the first half of Round 1.");
});

test("choosing a plan: each plan says what it opens, and Basic says what its free trial includes", async ({ page }) => {
  await mount(page, NEW);
  const basic = page.locator("label.ui-choice").filter({ hasText: "Basic" });
  const pro = page.locator("label.ui-choice").filter({ hasText: "Pro" });
  await expect(basic).toContainText("Skill tracks: Rounds 1 and 2.");
  await expect(basic).toContainText("During the free trial: Courses: modules 1 and 2.");
  // The picks sentence (the same on the trial and Basic) appears once, not twice.
  expect((await basic.innerText()).match(/Up to 3 skills/g)).toHaveLength(1);
  await expect(basic).toContainText("Skill tracks: the first half of Round 1.");
  await expect(pro).toContainText("Skill tracks: all 3 Rounds.");
  await expect(pro).not.toContainText("During the free trial");
});

for (const width of [1280, 390]) {
  test(`axe at ${width}px, on the trial and choosing a plan`, async ({ page }) => {
    await mount(page, TRIAL, width);
    expect(await axe(page)).toEqual([]);
    await mount(page, NEW, width);
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
