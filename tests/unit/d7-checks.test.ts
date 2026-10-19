/**
 * Design rebuild D7 · The static half of the checks (the browser half is in e2e/components/design-routes.spec.ts):
 * no overshooting ("bounce") easing or keyframes, no gradient text, motion that animates only transform, opacity and
 * gradient position (with the listed exceptions), the cheaper blurs, the globe following a theme switch, and the
 * prototype-port classes nothing used are gone.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? cssFiles(p) : n.endsWith(".css") ? [p] : [];
});
// The unloaded old scene code (decision 1) is kept as it is and never loaded.
const CSS = cssFiles("app").filter((f) => !f.startsWith("app/env/") && !f.startsWith("app/landing/world/"));
const all = CSS.map((f) => [f, readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")] as const);

describe("D7 · no bounce, no gradient text", () => {
  it("no cubic-bezier overshoots (y outside 0..1) in any loaded stylesheet; --ease-spring no longer bounces", () => {
    for (const [f, css] of all) for (const m of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
      const v = m[1].split(",").map(Number);
      expect([v[1], v[3]].every((y) => y >= 0 && y <= 1), `${f}: ${m[0]}`).toBe(true);
    }
  });
  it("icon hover keyframes go out and back once (no swing past rest, no undershoot)", () => {
    const design = all.find(([f]) => f === "app/styles/design.css")![1];
    for (const k of ["pop", "flap", "sway", "swing", "jolt"]) {
      const body = design.match(new RegExp(`@keyframes ds-ic-${k} \\{(.*)\\}`))![1];
      const stops = [...body.matchAll(/(\d+%(?:, \d+%)?) \{ transform: ([^;]*); \}/g)];
      expect(stops.length, k).toBeLessThanOrEqual(3); // rest → one peak → rest
    }
  });
  it("no gradient text anywhere", () => {
    for (const [f, css] of all) expect(css, f).not.toMatch(/background-clip:\s*text|-webkit-text-fill-color:\s*transparent/);
  });
});

describe("D7 · motion and performance", () => {
  it("the course progress fill grows by transform, not width", () => {
    expect(readFileSync("app/ui/neo.tsx", "utf8")).toMatch(/transform: `scaleX\(\$\{pct \/ 100\}\)`/);
    expect(readFileSync("app/ui/neo.css", "utf8")).not.toMatch(/transition: width/);
  });
  it("Reduced and Off stop every animation inside restyled pages", () => {
    expect(readFileSync("app/styles/pages.css", "utf8")).toMatch(/:root\[data-reduced="1"\] main\.ds-page \*, [^{]*\{ animation: none !important;/);
  });
  it("cheaper blurs with the same look: orbs 36px (was 70/80), frosted panels 16px (was 22)", () => {
    const bd = readFileSync("app/ui/backdrop/backdrop.css", "utf8");
    expect(bd).toMatch(/\.bd__orb \{ border-radius: 50%; filter: blur\(36px\);/);
    expect(bd).not.toMatch(/blur\((70|80)px\)/);
    expect(readFileSync("app/styles/tokens.css", "utf8")).toMatch(/--blur-panel: 16px;/);
  });
  it("the globe follows a theme switch while the Profile is open", () => {
    const g = readFileSync("app/learn/progress/profile/globe-canvas.tsx", "utf8");
    expect(g).toMatch(/attributeFilter: \["data-theme"\]/);
    expect(g).toMatch(/recolor\.disconnect\(\)/);
  });
});

describe("D7 · dead code from the prototype port", () => {
  it(".ds-rise, .ds-drop and .ds-hover are gone (nothing used them); the stagger keeps its keyframes", () => {
    const css = all.map(([, c]) => c).join("\n");
    expect(css).not.toMatch(/\.ds-rise\b|\.ds-drop\b|\.ds-hover\b|@keyframes ds-drop/);
    expect(css).toMatch(/@keyframes ds-rise/);
  });
});
