/**
 * Design rebuild D1 · Themes, font, icons and the preview page.
 *   Mono keeps every text color at 4.5:1 and control borders at 3:1 on its own backgrounds (Iris is the D1 palette,
 *   already checked in design-tokens.test.ts). Both themes define the same rebuild tokens. The Ascentra font is
 *   self-hosted with font-display: swap and preloaded. Icons are server-safe and their motion stops when reduced.
 *   The /dev/design preview is closed on production and linked from nowhere.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, PALETTE } from "@/app/ui/palette";
import { ICON_NAMES, ICONS } from "@/app/ui/design/ds-icon";

const tokens = readFileSync("app/styles/tokens.css", "utf8");
const design = readFileSync("app/styles/design.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const block = (selector: string) => {
  const at = tokens.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return tokens.slice(at, tokens.indexOf("\n}", at));
};
const value = (css: string, name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\b`, "i"))?.[1];

describe("D1 rebuild · Mono theme", () => {
  const mono = block('[data-theme="mono"]');
  const backgrounds = ["--color-base", "--color-surface", "--color-raised"];
  const texts = ["--color-text", "--color-text-muted", "--color-accent", "--color-accent-strong", "--color-ink", "--color-ink-muted", "--widget-streak", "--widget-points", "--widget-rank", "--widget-next"];
  // Status hues are not overridden by Mono: they come from :root.
  const statuses = ["--color-success", "--color-warning", "--color-danger", "--color-demo", "--color-simulated"];

  it("every text color reaches 4.5:1 and control borders 3:1 on Mono's backgrounds", () => {
    for (const b of backgrounds) {
      const bg = value(mono, b)!;
      expect(bg, b).toBeTruthy();
      for (const f of texts) expect(contrast(value(mono, f)!, bg), `${f} on ${b}`).toBeGreaterThanOrEqual(4.5);
      for (const f of statuses) expect(contrast(value(tokens, f)!, bg), `${f} on ${b}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(value(mono, "--color-line-strong")!, bg), `line-strong on ${b}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(value(mono, "--color-on-accent")!, value(mono, "--color-accent")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("Iris defines every token Mono overrides (so switching never leaves one unset)", () => {
    const names = [...mono.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]);
    const iris = tokens.slice(0, tokens.indexOf("\n[data-theme=\"mono\"] {"));
    for (const n of names) expect(iris, n).toMatch(new RegExp(`${n}:`));
  });

  it("an Iris region inside a Mono page resets to exactly the D1 palette", () => {
    const iris = block(':root,\n[data-theme="iris"]');
    for (const [name, hex] of Object.entries(PALETTE)) {
      if (value(mono, `--${name}`)) expect(value(iris, `--${name}`), name).toBe(hex);
    }
  });

  it("the rebuild's easing, motion tokens and layers exist, and stop with data-reduced", () => {
    expect(tokens).toMatch(/--ease-glide:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    for (const z of ["--z-scene", "--z-hud", "--z-popover", "--z-reward"]) expect(tokens, z).toContain(`${z}:`);
    const reduced = tokens.slice(tokens.indexOf(':root[data-reduced="1"]'));
    for (const d of ["--duration-press", "--duration-hover", "--duration-enter", "--duration-icon"]) expect(reduced, d).toMatch(new RegExp(`${d}:\\s*0ms`));
    expect(reduced).toMatch(/--tilt-max:\s*0deg/);
  });
});

describe("D1 rebuild · the Ascentra font", () => {
  it("is self-hosted, swaps, and is preloaded by the root layout; no Google Fonts", () => {
    expect(statSync("public/fonts/AscentraSemi.woff2").size).toBeGreaterThan(1000);
    expect(design).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Ascentra Display";[^}]*url\("\/fonts\/AscentraSemi\.woff2"\)[^}]*font-display:\s*swap/);
    expect(layout).toMatch(/preload\("\/fonts\/AscentraSemi\.woff2", \{ as: "font", type: "font\/woff2", crossOrigin: "anonymous" \}\)/);
    expect(design + tokens).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(tokens).toMatch(/--font-ascentra:\s*"Ascentra Display", var\(--font-sans\)/);
  });
});

describe("D1 rebuild · icons", () => {
  it("ports the full prototype set, with no client-only code", () => {
    expect(ICON_NAMES.length).toBe(31); // every icon in design-reference/src/Icons.jsx
    for (const n of ICON_NAMES) { const g: { l?: string; a?: string } = ICONS[n]; expect(g.l ?? g.a, n).toBeTruthy(); }
    const src = readFileSync("app/ui/design/ds-icon.tsx", "utf8");
    expect(src).not.toMatch(/^["']use client["']/m);
    expect(src).not.toMatch(/\buse(State|Effect|Ref|Context)\b/);
    expect(layout).toMatch(/<IconDefs \/>/);
  });

  it("animates only while motion is on", () => {
    const animated = [...design.matchAll(/^([^@\n{]*)\{[^}]*animation:\s*ds-ic/gm)].map((m) => m[1]);
    expect(animated.length).toBeGreaterThan(5);
    for (const sel of animated) expect(sel, sel).toMatch(/:root:not\(\[data-reduced="1"\]\)/);
    expect(design).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.ds-icon, \.ds-icon \* \{ animation: none !important; \}/);
  });
});

describe("D1 rebuild · the /dev/design preview", () => {
  it("is closed on production", () => {
    expect(readFileSync("app/dev/design/page.tsx", "utf8")).toMatch(/if \(!phaseQueryAllowed\(process\.env\.NODE_ENV, process\.env\.VERCEL_ENV\)\) notFound\(\);/);
  });

  it("is not linked from any product screen", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(f)) files.push(p); } };
    walk("app");
    for (const f of files.filter((p) => !p.startsWith(join("app", "dev")))) expect(readFileSync(f, "utf8"), f).not.toContain("/dev/design");
  });
});
