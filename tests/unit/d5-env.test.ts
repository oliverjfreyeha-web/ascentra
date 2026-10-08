/**
 * D5 · Environments and glass: the removed frost-crystal code never comes back, glints and sparkles repeat no faster
 * than every 6 s, the live wallpaper is capped at 30 fps and loads lazily, and the landing keeps its locked facts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageUrl, MIN_GLINT_PERIOD_S } from "@/app/env/env-gl";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? (f === "node_modules" || f.startsWith(".") ? [] : walk(p)) : [p];
});
const code = ["app", "lib"].flatMap(walk).filter((f) => /\.(tsx?|css|mjs|js)$/.test(f));
const gl = readFileSync("app/env/env-gl.ts", "utf8");

describe("D5 · the prototype's dead frost-crystal code never ships", () => {
  it("no file under app or lib references the frost crystals, sparkle tips or ice canvas", () => {
    for (const f of code) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/canvas\.ice|\bcrystals\s*\(|\biceAll\b|snowflake|\.tip\s*\{|\.fl\s*[{,]|\.fb\s*[{,]|\.ft\s*[{,]|\.fr\s*[{,]|\bvar FR\b/);
      if (f.endsWith(".css")) expect(s, f).not.toMatch(/(^|[\s,}])\.(fl|fb|ft|fr|tip)\b(?![-\w])/m);
    }
  });
});

describe("D5 · motion safety and performance", () => {
  it("every glint and sparkle repeats no faster than once every 6 s", () => {
    expect(MIN_GLINT_PERIOD_S).toBeGreaterThanOrEqual(6);
    expect(gl).toMatch(/sin\(t\*\(\.5\+\.5\*gh\)\+gh\*40\.\)/); // angular speed ≤ 1 rad/s
    expect(gl).toMatch(/PARTICLE_PULSE_MS = 2000/); // |sin(now/2000)| repeats every ~6.3 s
    expect(readFileSync("app/styles/glass.css", "utf8")).toMatch(/animation: glass-sheen 12s/);
  });
  it("the shader is capped at 30 fps, pauses when hidden or covered, downgrades when slow, and caps the pixel ratio at 1.5", () => {
    expect(gl).toMatch(/if \(now - last < 33\) return; \/\/ 30 fps cap/);
    expect(gl).toMatch(/document\.hidden/);
    expect(gl).toMatch(/dialog\[open\]/);
    expect(gl).toMatch(/if \(now - winStart >= 2000\) \{\s*if \(sum \/ count > 40\) \{ opts\.onSlow\(\); return; \}/);
    expect(gl).toMatch(/Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\)/);
  });
  it("the wallpaper code loads only after idle, as its own chunk, and never on admin screens", () => {
    const root = readFileSync("app/env/env-root.tsx", "utf8");
    expect(root).toMatch(/import\("\.\/env-gl"\)/);
    expect(root).toMatch(/requestIdleCallback/);
    expect(root).toMatch(/startsWith\("\/admin"\)\) return null/);
    expect(root).toMatch(/hardwareConcurrency \?\? 8\) <= 4 \|\| \(nav\.deviceMemory \?\? 8\) <= 4/);
    for (const f of code.filter((x) => !x.startsWith("app/env/"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/from "[./]*env\/env-gl"|from "\.\/env-gl"/);
  });
  it("small windows get the 1080 px photo, so it is never upscaled there", () => {
    expect(imageUrl("lake", 899)).toBe("/env/lake-1080.webp");
    expect(imageUrl("lake", 900)).toBe("/env/lake-1920.webp");
    const css = readFileSync("app/env/env.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 899\.98px\)[^]*lake-1080\.webp/);
  });
  it("the wallpaper files stay within their size budgets", () => {
    for (const s of ["reef", "lake", "mist", "sun"]) {
      expect(statSync(`public/env/${s}-1920.webp`).size, s).toBeLessThanOrEqual(300 * 1024);
      expect(statSync(`public/env/${s}-1080.webp`).size, s).toBeLessThanOrEqual(160 * 1024);
    }
  });
});

describe("D5 · the landing keeps its locked facts and truthful labels", () => {
  const hero = readFileSync("app/landing/world/world-hero.tsx", "utf8");
  it("prices, trial and eligibility come from the billing terms and the agreed copy", () => {
    expect(hero).toMatch(/Start your \{TRIAL_DAYS\}-day free trial/);
    expect(hero).toMatch(/Try the full \{basic\.name\} experience for \{TRIAL_DAYS\} days\. After the trial your plan continues as \{basic\.name\}\./);
    expect(hero).toMatch(/United States only\. Ages 14 and up\. Ages 14 to 17 need a verified guardian\./);
    expect(hero).toMatch(/Learn inside a/);
  });
  it("no prototype badge, demo notice, dead link or income promise", () => {
    expect(hero).not.toMatch(/Prototype|data-demo|not connected|<span>Courses<\/span>/);
    expect(hero).toMatch(/href="\/sign-up"/);
    expect(hero).toMatch(/href="\/sign-in"/);
    expect(hero).not.toMatch(/\b(earn|income|make money|\$\d+k)\b/i);
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toMatch(/id="features-h"/);
    expect(page).toMatch(/"guardians"/);
    expect(hero).toMatch(/id="plans"/);
  });
  it("the scene and glass pickers are real buttons with aria-pressed", () => {
    const dock = readFileSync("app/landing/world/world-controls.tsx", "utf8");
    expect(dock).toMatch(/<button key=\{s\} type="button" className="world__pill ui-plain" aria-pressed=\{scene === s\}/);
    expect(dock).toMatch(/<button key=\{g\} type="button" className="world__pill ui-plain" aria-pressed=\{glass === g\}/);
  });
  it("the course UI showcase is preview-only and labelled Example", () => {
    expect(readFileSync("app/dev/course-ui/page.tsx", "utf8")).toMatch(/if \(!phaseQueryAllowed\(process\.env\.NODE_ENV, process\.env\.VERCEL_ENV\)\) notFound\(\);/);
    expect(readFileSync("app/dev/course-ui/showcase.tsx", "utf8")).toMatch(/Example/);
  });
});
