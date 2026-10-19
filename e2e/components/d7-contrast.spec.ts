/**
 * Design rebuild D7 · Screenshot-based contrast on every restyled route (the D6 route list, with D4 and D5), both themes,
 * Frosted and Liquid, 1280px. For a sample of text elements per page (deduplicated by colour, size and surface), the
 * element is captured with its text and again with the text made transparent; the ink is compared with the lightest and
 * darkest background pixels behind it (2nd and 98th percentile). Body text needs 4.5:1, large text (24px, or 18.66px
 * bold) 3:1. The Iris primary button is measured the same way on every page that has one. Not part of CI: runs with
 * DESIGN_SHOTS=1 and writes docs/design/shots/d7-contrast-<theme>-<glass>.json. A text halo (text-shadow) stays in the
 * capture without text, so it counts as the background, as WCAG allows; disabled controls are left out (exempt).
 */
import { writeFileSync } from "node:fs";
import { test, type Locator, type Page } from "@playwright/test";
import { buildShell, openShell } from "./fixtures/shell-harness";
import { ROUTES } from "./fixtures/routes";

test.skip(!process.env.DESIGN_SHOTS, "Contrast sampling only on request (DESIGN_SHOTS=1).");
let bundle = "";
test.beforeAll(async () => { bundle = await buildShell(); });

const lum = (r: number, g: number, b: number) => { const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b); };
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Background behind the glyphs only: the element is captured with and without its text, and only the pixels the text
 * changed are kept (so rounded corners, borders and neighbours don't count). Returns the [2nd, 98th] percentile RGB of
 * the background under those pixels, or null if the element couldn't be captured or has too few glyph pixels.
 */
async function backdrop(page: Page, el: Locator): Promise<number[][] | null> {
  let withText: Buffer, without: Buffer;
  try {
    await el.scrollIntoViewIfNeeded({ timeout: 3000 });
    withText = await el.screenshot({ animations: "disabled", timeout: 3000 });
    await el.evaluate((e) => e.setAttribute("data-d7-hide", ""));
    without = await el.screenshot({ animations: "disabled", timeout: 3000 });
  } catch { return null; } finally { await el.evaluate((e) => e.removeAttribute("data-d7-hide")).catch(() => undefined); }
  return page.evaluate(async ([a64, b64]) => {
    const load = async (src: string) => { const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d")!; x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
    const t = await load(a64), b = await load(b64);
    if (t.length !== b.length) return null;
    const ch = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const px: [number, number, number, number][] = [];
    for (let k = 0; k < t.length; k += 4) {
      if (Math.abs(t[k] - b[k]) + Math.abs(t[k + 1] - b[k + 1]) + Math.abs(t[k + 2] - b[k + 2]) < 60) continue; // not under a glyph
      px.push([0.2126 * ch(b[k]) + 0.7152 * ch(b[k + 1]) + 0.0722 * ch(b[k + 2]), b[k], b[k + 1], b[k + 2]]);
    }
    if (px.length < 12) return null;
    px.sort((p, q) => p[0] - q[0]);
    const at = (q: number) => px[Math.min(px.length - 1, Math.floor(px.length * q))].slice(1);
    return [at(0.02), at(0.98)];
  }, [withText.toString("base64"), without.toString("base64")]);
}

type Row = { route: string; theme: string; glass: string; what: string; text: string; ink: string; large: boolean; worst: number; need: number };

for (const theme of ["iris", "mono"]) for (const glass of ["frost", "liquid"]) {
  test(`text contrast over glass (${theme}, ${glass})`, async ({ page }) => {
    test.setTimeout(1800000);
    const rows: Row[] = [];
    for (const r of ROUTES) {
      await openShell(page, bundle, { path: r.path, role: r.role, api: r.api ?? {}, apiStatus: r.status, saved: { "ascentra.theme": theme, "ascentra.glass": glass } });
      await page.addStyleTag({ content: "[data-d7-hide], [data-d7-hide] * { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } [data-d7-hide] svg, [data-d7-hide] img, [data-d7-hide] canvas { visibility: hidden !important; } *, *::before, *::after { transition: none !important; }" });
      await page.waitForTimeout(900);
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))));
      // Pick text elements: direct text, visible, deduplicated by ink, size, weight and nearest surface; primaries always.
      const picked = await page.evaluate(() => {
        const seen = new Set<string>(), out: { idx: number; key: string; large: boolean; ink: string; text: string; primary: boolean }[] = [];
        const els = [...document.querySelectorAll<HTMLElement>("main *, .app-hud *")];
        els.forEach((e, idx) => {
          const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim().length > 1);
          const primary = e.matches(".ds-btn--primary, .ui-btn--primary, button.primary");
          if (e.closest(":disabled, [aria-disabled='true']")) return; // disabled controls are exempt (WCAG 1.4.3)
          if (!own && !primary) return;
          const s = getComputedStyle(e), r = e.getBoundingClientRect();
          if (r.width < 8 || r.height < 8 || s.visibility === "hidden" || +s.opacity === 0 || e.closest("[aria-hidden='true'], .sr-only, svg")) return;
          if (e.closest(".ds-btn--primary, .ui-btn--primary, button.primary") && !primary) return;
          const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
          const surface = e.closest(".ds-glass, .ui-block, .ui-panel, .ui-auth__card, .ui-card, .notice, .ui-legal, section, table, .app-hud")?.className.toString().split(" ")[0] ?? "page";
          const key = `${primary ? "P" : ""}|${s.color}|${Math.round(size)}|${s.fontWeight}|${surface}`;
          if (seen.has(key)) return;
          seen.add(key);
          e.setAttribute("data-d7", String(idx));
          out.push({ idx, key, large, ink: s.color, text: (e.textContent ?? "").trim().slice(0, 40), primary });
        });
        return out.slice(0, 40);
      });
      for (const p of picked) {
        const el = page.locator(`[data-d7="${p.idx}"]`);
        const bg = await backdrop(page, el);
        if (!bg) continue;
        const m = p.ink.match(/[\d.]+/g)!.map(Number), a = m[3] ?? 1;
        // Ink with alpha: blend over each background extreme.
        const inkOver = (b: number[]) => lum(m[0] * a + b[0] * (1 - a), m[1] * a + b[1] * (1 - a), m[2] * a + b[2] * (1 - a));
        const worst = Math.min(ratio(inkOver(bg[0]), lum(bg[0][0], bg[0][1], bg[0][2])), ratio(inkOver(bg[1]), lum(bg[1][0], bg[1][1], bg[1][2])));
        rows.push({ route: `${r.path} (${r.role ?? "visitor"})`, theme, glass, what: p.primary ? "primary button" : p.key.split("|")[4], text: p.text, ink: p.ink, large: p.large && !p.primary, worst: +worst.toFixed(2), need: p.large && !p.primary ? 3 : 4.5 });
      }
    }
    writeFileSync(`docs/design/shots/d7-contrast-${theme}-${glass}.json`, `${JSON.stringify({ sampled: rows.length, below: rows.filter((x) => x.worst < x.need), primaries: rows.filter((x) => x.what === "primary button") }, null, 1)}\n`);
  });
}
