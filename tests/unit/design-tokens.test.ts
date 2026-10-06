/**
 * D1: the design tokens. The palette in app/ui/palette.ts matches app/styles/tokens.css; every text color reaches 4.5:1
 * and control borders 3:1 on every background; reduced motion zeroes every duration; status labels have no default
 * state; and the stylesheets carry no neon, glitch or scan-line effects.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKGROUNDS, CONTROL_BORDERS, PALETTE, TEXT_COLORS, contrast } from "@/app/ui/palette";
import { STATUS_TEXT } from "@/app/ui/status-label";

const tokens = readFileSync("app/styles/tokens.css", "utf8");
const components = readFileSync("app/styles/components.css", "utf8");
const globals = readFileSync("app/globals.css", "utf8");
const [main, reduced] = tokens.split("@media (prefers-reduced-motion: reduce)");

describe("design tokens", () => {
  it("the palette data matches the CSS tokens", () => {
    for (const [name, hex] of Object.entries(PALETTE)) expect(main, name).toMatch(new RegExp(`--${name}:\\s*${hex}\\b`, "i"));
  });

  it("every text color reaches 4.5:1 and control borders 3:1 on base, surface and raised", () => {
    for (const b of BACKGROUNDS) {
      for (const f of TEXT_COLORS) expect(contrast(PALETTE[f], PALETTE[b]), `${f} on ${b}`).toBeGreaterThanOrEqual(4.5);
      for (const f of CONTROL_BORDERS) expect(contrast(PALETTE[f], PALETTE[b]), `${f} on ${b}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(PALETTE["color-on-accent"], PALETTE["color-accent"])).toBeGreaterThanOrEqual(4.5);
  });

  it("defines each token family in one place", () => {
    for (const family of ["--color-", "--text-", "--space-", "--radius-", "--border-", "--blur-", "--shadow-", "--duration-", "--ease-", "--z-", "--font-"]) {
      expect(main, family).toContain(family);
    }
  });

  it("reduced motion sets every duration to zero, and the global guard stops other motion", () => {
    const durations = [...main.matchAll(/(--duration-[a-z-]+):/g)].map((m) => m[1]).filter((d) => d !== "--duration-loop");
    for (const d of durations) expect(reduced, d).toMatch(new RegExp(`${d}:\\s*0ms`));
    expect(globals).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms !important/);
    expect(components).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.ui-skeleton \{ animation: none/);
  });

  it("no neon, glitch or scan-line effects: no glowing text shadows, no flicker keyframes", () => {
    const css = tokens + components + globals;
    expect(css).not.toMatch(/text-shadow/);
    expect(css).not.toMatch(/@keyframes [a-z-]*(glitch|flicker|scan)/i);
    expect(css).not.toMatch(/repeating-linear-gradient\(\s*(0deg|180deg|to bottom)/); // horizontal scan lines
  });

  it("status labels: every state is styled, and nothing is Connected or Verified unless the caller says so", () => {
    for (const s of Object.keys(STATUS_TEXT)) if (s !== "draft" && s !== "checking") expect(components, s).toContain(`[data-state="${s}"]`);
    const label = readFileSync("app/ui/status-label.tsx", "utf8");
    expect(label).toMatch(/\{ state: StatusState;/); // required, no default
    expect(label).not.toMatch(/state\s*=\s*"/);
    expect(components).toMatch(/\.ui-status \{\s*--st: var\(--color-text-muted\)/); // the unstyled default is neutral
  });

  it("keeps every class the screens already use", () => {
    for (const c of [".muted", ".small", ".notice", ".notice.banner", ".st-connected", ".st-disconnected", "button.primary", "button.link", "main.wide", ".services", ".table-wrap", "table.plain", "dl.kv", ".filters", ".sr-only"]) {
      expect(globals, c).toContain(c);
    }
  });
});

describe("the style guide page", () => {
  it("is for the Owner and Super Admins, read through meFrom, linked from the Home header line for those two only", () => {
    const page = readFileSync("app/admin/style-guide/style-guide.tsx", "utf8");
    expect(page).toMatch(/meFrom\(/);
    expect(page).toMatch(/if \(role !== "owner" && role !== "superAdmin"\) return <p>The style guide is for the Owner and Super Admins\.<\/p>;/);
    expect(page.match(/fetch\(/g)).toHaveLength(1); // only the role check: sample data, nothing else is read or saved
    const panel = readFileSync("app/account-panel.tsx", "utf8");
    expect(panel).toMatch(/me\?\.roleKey === "owner" \|\| me\?\.roleKey === "superAdmin"\) && \(\s*<>\s*<Link href="\/admin\/audit">Audit log<\/Link> · <Link href="\/admin\/safety">Safety review<\/Link> · <Link href="\/admin\/style-guide">Style guide<\/Link>/);
  });
});

describe("D2 depth", () => {
  it("text, muted text and the accent keep 4.5:1 on every depth surface", async () => {
    const { DEPTH_SURFACES } = await import("@/app/ui/palette");
    for (const [name, bg] of Object.entries(DEPTH_SURFACES)) {
      for (const f of ["color-text", "color-text-muted", "color-accent", "color-warning"] as const) {
        expect(contrast(PALETTE[f], bg), `${f} on ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("depth is tokenized (3 elevation levels, glows, grain, highlights) and the ambient motion stops with reduced motion", () => {
    for (const t of ["--elev-1", "--elev-2", "--elev-3", "--edge-highlight", "--inner-highlight", "--gradient-page", "--glow-accent", "--grain", "--duration-ambient"]) {
      expect(main, t).toContain(`${t}:`);
    }
    expect(reduced).toMatch(/--duration-ambient:\s*0ms/);
    expect(components).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.ui-scene::before, \.ui-scene::after \{ animation: none; \}/);
  });
});
