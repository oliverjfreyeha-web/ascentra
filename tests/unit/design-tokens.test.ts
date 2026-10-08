/**
 * D1: the design tokens. The palette in app/ui/palette.ts matches app/styles/tokens.css; every text color reaches 4.5:1
 * and control borders 3:1 on every background; reduced motion zeroes every duration; status labels have no default
 * state; and the stylesheets carry no neon, glitch or scan-line effects.
 */
import { readFileSync, statSync } from "node:fs";
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

  it("D2b: depth from light and texture: tokens exist, and there is no gloss, bevel or blob glow", () => {
    for (const t of ["--elev-1", "--elev-2", "--elev-3", "--edge-light", "--noise-panel", "--texture-grid", "--texture-lines", "--spotlight", "--gradient-page", "--grain", "--duration-ambient"]) {
      expect(main, t).toContain(`${t}:`);
    }
    expect(reduced).toMatch(/--duration-ambient:\s*0ms/);
    const css = tokens + components + globals;
    expect(css).not.toMatch(/rgb\(255 255 255 \/ 0\.22\)/); // the glossy button sheen
    expect(css).not.toMatch(/filter: blur\(64px\)/); // blob glows
    expect(main).toMatch(/--inner-highlight: none;/);
    expect(main).not.toMatch(/--elev-\d:[^;]*inset/); // no bevelled top light in the shadows
  });

  it("D2b motion respects reduced motion: reveals and the spotlight are off (D4: the Hall has its own block)", () => {
    expect(readFileSync("app/ui/reveal.tsx", "utf8")).toMatch(/prefers-reduced-motion: reduce\)"\)\.matches/);
    expect(readFileSync("app/ui/spotlight.tsx", "utf8")).toMatch(/prefers-reduced-motion: reduce\)"\)\.matches/);
    expect(components).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \[data-reveal="wait"\] \{ opacity: 1; transform: none; \}/);
  });
});

describe("D2c: art, HUD, fonts, sound and credits", () => {
  it("the ambient sound control is opt-in and never in lessons (D2e moved the player to the root layout)", () => {
    const src = readFileSync("app/ui/ambient-sound.tsx", "utf8");
    expect(src).not.toMatch(/autoPlay|autoplay/);
    expect(src).toMatch(/aria-pressed=\{state\.on\}/);
    expect(src).not.toMatch(/new Audio\(/); // the control holds no audio; the persistent player does
    expect(readFileSync("app/learn/[id]/page.tsx", "utf8")).not.toMatch(/SiteFooter|AmbientSound/); // not in lessons
  });

  it("credits say truthfully that the art and music were made with AI (DaVinci AI), and the repo lists each asset's tool", () => {
    const page = readFileSync("app/credits/page.tsx", "utf8");
    expect(page).toMatch(/were made with AI, using DaVinci AI, and are used under that service&apos;s terms/);
    const doc = readFileSync("docs/design/ASSETS.md", "utf8");
    for (const a of ["hero-glass-sculpture", "texture-topographic", "card-glass-panels", "ambient-loop"]) expect(doc).toContain(a);
    expect(readFileSync("app/ui/site-footer.tsx", "utf8")).toMatch(/href="\/credits"/);
  });

  it("the headline face is one token, defaulting to the current pairing; HUD details stay off the lesson and admin screens", () => {
    expect(main).toMatch(/--font-headline: var\(--font-display\);/);
    expect(components).not.toMatch(/\.ui-lesson[^{]*hud|hud[^{]*\.ui-lesson/);
    for (const f of ["app/learn/[id]/lesson-reader.tsx", "app/lesson-body.tsx", "app/admin/audit/audit-log.tsx"]) expect(readFileSync(f, "utf8")).not.toMatch(/hud-|Crosshair/);
  });
});


describe("D2d → D4: the 3D hero, frost, effect tiles and tilt are retired", () => {
  it("the old 3D hero stays in the repo but no page loads it, so three.js is out of the landing bundle", () => {
    expect(statSync("app/landing/hero-3d.ts").size).toBeGreaterThan(1000);
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).not.toMatch(/HeroScene|hero-3d|hero-scene|from "three/);
    expect(readFileSync("app/landing/hall/hall.tsx", "utf8") + readFileSync("app/landing/hall/hall-life.tsx", "utf8")).not.toMatch(/from "three|hero-3d|hero-scene/);
  });
  it("the frost overlay, effect tiles, tilt glare and HUD marks are gone from the code and the assets", () => {
    for (const f of ["app/ui/frost.tsx", "app/ui/hud.tsx", "app/landing/effect-tiles.tsx", "app/landing/tilt-cards.tsx", "app/landing/hero-motion.tsx", "public/art/frost.webp"]) expect(() => statSync(f), f).toThrow();
    const css = components + readFileSync("app/styles/polish.css", "utf8") + readFileSync("app/styles/glass.css", "utf8") + globals;
    expect(css).not.toMatch(/border-image|\.frost\b|\.hud-|\.fx-tile|tilt-glare|--frost-strength/);
    expect(readFileSync("app/page.tsx", "utf8")).not.toMatch(/<Frost|Crosshair|hud-|data-tilt|EffectTiles|TiltCards/);
  });
});

describe("D3: glow, motion and activities", () => {
  const polish = readFileSync("app/styles/polish.css", "utf8");
  it("glow is a token set built from the palette, and status labels never glow", () => {
    for (const t of ["--glow-ice", "--glow-frozen", "--glow-steel", "--glow-blur", "--glow-spread", "--glow-ring"]) expect(main).toContain(t);
    expect(polish).toMatch(/\.ui-status, \.st, \.ui-status \* \{ box-shadow: none !important; text-shadow: none !important; filter: none !important; \}/);
  });
  it("ambient motion is landing-only, pauses off-screen, and stops with reduced motion", () => {
    expect(polish).toMatch(/\[data-ambient\]\[data-paused\][^{]*\{ animation-play-state: paused !important; \}/);
    const rm = polish.slice(polish.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toMatch(/\.closing__glow, \.ui-btn--breathe::after/);
    expect(readFileSync("app/learn/[id]/page.tsx", "utf8")).not.toMatch(/Reveal|AmbientPause|data-ambient/);
    expect(readFileSync("app/ui/ambient-pause.tsx", "utf8")).not.toMatch(/SoundEngine|useSound/); // animations only, never the sound
  });
  it("graded and practice items look different and keep their labels in words", () => {
    const src = readFileSync("app/learn/[id]/practice.tsx", "utf8");
    expect(src).toMatch(/data-graded=\{a\.graded \? "true" : "false"\}/);
    expect(src).toMatch(/\{a\.graded \? "Graded" : a\.label\}/);
    expect(polish).toMatch(/\.ui-act\[data-graded="false"\][^{]*\{ border: 1px dashed/);
    expect(polish).toMatch(/@keyframes result-in \{ from \{ transform: translateY\(6px\); \} \}/); // transform only: never hides the answer
  });
});

describe("D3 pass 3: brand, 4K and accessibility", () => {
  const polish = readFileSync("app/styles/polish.css", "utf8");
  it("brand assets are built from the palette and wired up", () => {
    for (const f of ["app/icon.svg", "app/favicon.ico", "app/apple-icon.png", "app/opengraph-image.jpg", "public/icons/icon-192.png", "public/icons/icon-512.png", "public/icons/maskable-512.png"]) expect(statSync(f).size, f).toBeGreaterThan(500);
    expect(readFileSync("app/icon.svg", "utf8")).toMatch(/#080813/i);
    expect(readFileSync("app/manifest.ts", "utf8")).toMatch(/theme_color: "#080813"/);
  });
  it("raster art ships responsive widths up to its native size, never upscaled", () => {
    const pic = readFileSync("app/ui/picture.tsx", "utf8");
    expect(pic).toMatch(/cardGlass: \{ base: "\/art\/card-glass", widths: \[640, 960, 1280, 1600, 2000\], width: 2000/);
    for (const w of [1600, 2000]) expect(statSync(`public/art/card-glass-${w}.avif`).size).toBeGreaterThan(1000);
  });
  it("fluid type, contained scroll regions, coarse-pointer targets, admin stays plain", () => {
    expect(polish).toMatch(/html \{ font-size: clamp\(100%,/);
    expect(polish).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    expect(polish).toMatch(/main\.ui-admin \{ --spotlight: linear-gradient\(transparent, transparent\);[^}]*animation: none; \}/);
    expect(readFileSync("app/admin/audit/audit-log.tsx", "utf8")).toMatch(/className="table-wrap" tabIndex=\{0\} role="region"/);
    expect(readFileSync("app/lesson-body.tsx", "utf8")).toMatch(/<h2>\{s\.heading\}<\/h2>/);
  });
});
