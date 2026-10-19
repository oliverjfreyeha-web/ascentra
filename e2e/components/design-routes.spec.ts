/**
 * Design rebuild D6 · The remaining routes in a real Chromium with the real stylesheets and pages (the shell harness).
 *   Every route renders as a restyled page (main.ds-page); admin, billing, safety, audit, Guardian, sign-in, onboarding
 *   and legal pages are calm: hovering and clicking give no glow or spark, nothing tilts and nothing loops. Mono turns
 *   the old navy panels graphite. No sideways scroll at 390px. Motion Reduced and Off stop the page entrance too.
 * D7: axe (WCAG 2.0–2.2 A/AA and best practice) on every restyled route, D4–D6, in both themes and both glass types: no
 *   serious or critical issue. Also 768px with no sideways scroll.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { buildShell, openShell, type ShellOpts } from "./fixtures/shell-harness";
import { ROUTES, type Route } from "./fixtures/routes";

let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });


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
  test.setTimeout(240000);
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

const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
for (const theme of ["iris", "mono"]) for (const glass of ["frost", "liquid"]) {
  test(`axe: no serious or critical issue on any restyled route (${theme}, ${glass})`, async ({ page }) => {
    test.setTimeout(300000);
    const serious: string[] = [];
    for (const r of ROUTES) {
      await open(page, r, { saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
      await page.waitForTimeout(500);
      await settle(page);
      await page.addScriptTag({ content: AXE });
      serious.push(...await page.evaluate(async (where) => {
        type V = { id: string; impact: string; nodes: { target: unknown }[] };
        const res = await (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<{ violations: V[] }> } }).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] });
        return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${where}: ${v.impact} ${v.id} ${JSON.stringify(v.nodes[0]?.target)}`);
      }, `${r.path} (${r.role})`));
    }
    expect(serious).toEqual([]);
  });
}

test("768px: no sideways scroll on any route", async ({ page }) => {
  test.setTimeout(240000);
  for (const r of ROUTES) {
    await open(page, r, { width: 768 });
    await page.waitForTimeout(300);
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), r.path).toBeLessThanOrEqual(0);
  }
});

// D7 · Motion Reduced and Off stop everything on real pages: CSS animations, the backdrop, sparks, the glow, the globe
// and the counters.
for (const level of ["simple", "off"]) {
  test(`Motion ${level === "simple" ? "Reduced" : "Off"}: nothing moves at all (backdrop, sparks, glow, globe, counters)`, async ({ page }) => {
    test.setTimeout(180000);
    for (const r of ROUTES.filter((x) => ["/", "/learn", "/learn/progress", "/account", "/learn/track/copywriting", "/guardian"].includes(x.path) && x.role)) {
      await open(page, r, { saved: { "ascentra.motion": level } });
      // Counters show their final number at once.
      if (r.path === "/") {
        const stats = page.locator(".home-stat__big");
        await stats.first().waitFor();
        const first = await stats.allTextContents();
        await page.waitForTimeout(1200);
        expect(await stats.allTextContents(), "counters").toEqual(first);
      }
      await page.waitForTimeout(600);
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty));
      expect(running, r.path).toEqual([]);
      const btn = page.locator("main button:visible").first();
      if (await btn.count()) {
        await btn.hover();
        await expect(page.locator(".fx-glow"), r.path).not.toHaveAttribute("data-on", "");
        await btn.evaluate((e) => {
          e.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { once: true });
          const b = e.getBoundingClientRect();
          e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: b.left + 4, clientY: b.top + 4 }));
        });
        await expect(page.locator(".fx-burst"), r.path).toHaveCount(0);
      }
      expect(await page.evaluate(() => getComputedStyle(document.querySelector(".bd__orbs")!).transform), r.path).toBe("none");
      if (r.path === "/learn/progress") {
        const canvas = page.locator(".pf-globe__canvas[data-on]");
        await canvas.waitFor();
        const a = (await canvas.screenshot()).toString("base64");
        await page.waitForTimeout(1000);
        expect((await canvas.screenshot()).toString("base64"), "globe still").toBe(a);
      }
    }
  });
}

test("Liquid detaches fully when switched to Frosted on a real page (no lens, no filter, no inline value left)", async ({ page }) => {
  const r = ROUTES.find((x) => x.path === "/account")!;
  await open(page, r, { saved: { "ascentra.glass": "frost" } });
  await page.waitForTimeout(500);
  const state = () => page.evaluate(() => ({
    lenses: document.querySelectorAll("[data-lens]").length,
    inline: [...document.querySelectorAll<HTMLElement>("*")].filter((e) => e.style.getPropertyValue("--lg")).length,
    filters: document.querySelectorAll("svg filter").length,
  }));
  const frosted = await state();
  expect(frosted.lenses + frosted.inline).toBe(0);
  const glass = page.getByRole("group", { name: "Glass", exact: true });
  await glass.getByRole("button", { name: "Liquid" }).click();
  await expect.poll(async () => (await state()).lenses).toBeGreaterThan(0);
  const liquid = await state();
  expect(liquid.filters).toBeGreaterThan(frosted.filters);
  await glass.getByRole("button", { name: "Frosted" }).click();
  await expect.poll(state).toEqual(frosted);
});

// D7 · An offline stand-in for the "impeccable" detector (not installed here), on computed styles, so it sees what
// really renders: no gradient text, no side-stripe borders, no bounce (overshooting) easing, no purple text on a light
// background, and the HUD never moves on hover.
const detect = () => {
  const out: string[] = [];
  const name = (e: Element) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").filter(Boolean).slice(0, 2).join(".")}`;
  const overshoot = (tf: string) => [...tf.matchAll(/cubic-bezier\(([^)]*)\)/g)].some((m) => { const v = m[1].split(",").map(Number); return v[1] < 0 || v[1] > 1 || v[3] < 0 || v[3] > 1; });
  const lum = (c: string) => { const m = c.match(/[\d.]+/g); if (!m) return 0; const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(+m[0]) + 0.7152 * ch(+m[1]) + 0.0722 * ch(+m[2]); };
  const hue = (c: string) => { const [r, g, b] = (c.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((x) => +x / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (d < 0.15) return -1; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  for (const e of document.querySelectorAll<HTMLElement>("body *")) {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || s.visibility === "hidden") continue;
    if (s.backgroundClip === "text" || s.getPropertyValue("-webkit-background-clip") === "text") out.push(`gradient text: ${name(e)}`);
    for (const side of ["Left", "Right"] as const) {
      const w = parseFloat(s[`border${side}Width`]), other = parseFloat(s.borderTopWidth);
      if (w >= 2 && w > other && s[`border${side}Style`] === "solid") out.push(`side stripe (border-${side.toLowerCase()} ${w}px): ${name(e)}`);
    }
    if (/inset/.test(s.boxShadow) && /(?:^|,)\s*(?:rgba?\([^)]*\)\s*)?-?[2-9]px 0px 0px(?: 0px)?(?: rgba?\([^)]*\))? inset/.test(s.boxShadow)) out.push(`side stripe (inset shadow): ${name(e)}`);
    if (overshoot(`${s.transitionTimingFunction} ${s.animationTimingFunction}`)) out.push(`bounce easing: ${name(e)}`);
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (own) {
      let p: HTMLElement | null = e, bg = "";
      while (p) { const b = getComputedStyle(p).backgroundColor; if (b && !/rgba\([^)]*,\s*0\)|transparent/.test(b)) { bg = b; break; } p = p.parentElement; }
      const h = hue(s.color);
      if (bg && lum(bg) > 0.7 && h >= 250 && h <= 310) out.push(`purple on white: ${name(e)}`);
    }
  }
  return out;
};

for (const theme of ["iris", "mono"]) {
  test(`design detector: no gradient text, side stripes, bounce, purple-on-white, HUD hover movement (${theme})`, async ({ page }) => {
    test.setTimeout(480000);
    const found: string[] = [];
    const hoverOn = new Set(["/admin", "/learn", "/guardian", "/learn/progress"]); // the same HUD everywhere; one per kind
    for (const r of ROUTES) {
      await open(page, r, { saved: { "ascentra.theme": theme } });
      await page.waitForTimeout(400);
      await settle(page);
      found.push(...(await page.evaluate(detect)).map((f) => `${r.path} (${r.role}): ${f}`));
      const hud = page.locator(".app-hud");
      if (hoverOn.has(r.path) && await hud.count()) {
        const before = await hud.evaluate((e) => `${getComputedStyle(e).transform} ${e.getBoundingClientRect().top}`);
        for (const t of await page.locator(".app-hud a, .app-hud button").all()) { await t.hover(); await page.waitForTimeout(60); }
        expect(await hud.evaluate((e) => `${getComputedStyle(e).transform} ${e.getBoundingClientRect().top}`), `${r.path}: HUD moved on hover`).toBe(before);
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });
}

test("design detector catches each pattern when it is there (positive control)", async ({ page }) => {
  await open(page, ROUTES[0]);
  await page.evaluate(() => {
    const m = document.querySelector("main")!;
    m.insertAdjacentHTML("beforeend", `
      <p id="g" style="background: linear-gradient(red, blue); -webkit-background-clip: text; background-clip: text; color: transparent">Gradient</p>
      <div id="s" style="border-left: 3px solid red">Stripe</div>
      <div id="i" style="box-shadow: inset 3px 0 0 red">Inset stripe</div>
      <div id="b" style="transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1)">Bounce</div>
      <div style="background: #fff"><span id="p" style="color: #7c3aed">Purple</span></div>`);
  });
  const found = (await page.evaluate(detect)).join("\n");
  for (const k of ["gradient text: p.", "side stripe (border-left 3px): div.", "side stripe (inset shadow): div.", "bounce easing: div.", "purple on white: span."]) expect(found).toContain(k);
});
