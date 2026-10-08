/**
 * D4 · The Hall: the clock → phase mapping, the ?phase= review switch (never on production), the boot script matching
 * the module it is built from, the photosensitivity limits, the liquid glass tokens and their contrast floor, and the
 * asset budget.
 */
import { readFileSync, statSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootScript, cycleT, hallVars, K, PHASE_T, phaseFromQuery, phaseName, phaseQueryAllowed, WINDOWS, windowTimings } from "@/app/landing/hall/cycle";
import { contrast } from "@/app/ui/palette";
import FIREFLIES from "@/app/landing/hall/fireflies.json";

const css = readFileSync("app/landing/hall/hall.css", "utf8");
const glass = readFileSync("app/styles/glass.css", "utf8");
const life = readFileSync("app/landing/hall/hall-life.tsx", "utf8");
const at = (hh: number, mm = 0) => hh + mm / 60;

describe("D4 · the day cycle follows the visitor's local clock", () => {
  it("maps sample local times to the right phase", () => {
    const cases: [number, string][] = [
      [at(0, 30), "night"], [at(4, 59), "night"], [at(5), "dawn"], [at(6, 30), "dawn"], [at(7, 59), "dawn"], [at(8), "day"],
      [at(12), "day"], [at(16, 59), "day"], [at(17), "dusk"], [at(18, 30), "dusk"], [at(19, 59), "dusk"], [at(20), "night"], [at(23, 59), "night"],
    ];
    for (const [h, p] of cases) expect(phaseName(h), String(h)).toBe(p);
  });

  it("holds night and day, and passes smoothly through dawn and dusk (their looks peak at 06:30 and 18:30)", () => {
    expect(cycleT(at(2))).toBe(PHASE_T.night);
    expect(cycleT(at(12))).toBe(PHASE_T.day);
    expect(cycleT(at(6, 30))).toBeCloseTo(PHASE_T.dawn);
    expect(cycleT(at(18, 30)) % 1).toBeCloseTo(PHASE_T.dusk);
    expect(cycleT(at(8))).toBeCloseTo(PHASE_T.day); // dawn ends exactly where day holds
    expect(cycleT(at(20)) % 1).toBeCloseTo(PHASE_T.night); // dusk ends exactly where night holds (via 1.25 ≡ .25)
    for (let m = 0; m < 24 * 60; m += 5) { // never a jump bigger than a few minutes' worth
      const a = cycleT(m / 60), b = cycleT((m + 5) / 60);
      expect(Math.abs(((b - a + 1.5) % 1) - 0.5), `at ${m} min`).toBeLessThan(0.02);
    }
  });

  it("lights are on at dusk and night, dimmer at dawn, off by day; fireflies follow", () => {
    expect(hallVars(PHASE_T.dusk, K).vars["--win"]).toBe("1");
    expect(hallVars(PHASE_T.night, K).vars["--win"]).toBe("1");
    expect(hallVars(PHASE_T.dawn, K).vars["--win"]).toBe("0.45");
    expect(hallVars(PHASE_T.day, K).vars["--win"]).toBe("0");
    expect(hallVars(PHASE_T.day, K).ff).toBe(0);
    expect(hallVars(PHASE_T.night, K).ff).toBe(1);
    expect(hallVars(PHASE_T.day, K).vars["--scrim"]).toBe("1"); // the deepest scrim by day
    expect(hallVars(PHASE_T.night, K).vars["--imgf"]).toBe("brightness(0.62) saturate(0.9)");
    expect(hallVars(PHASE_T.dusk, K).vars["--imgf"]).toBe("none");
  });
});

describe("D4 · the ?phase= review switch", () => {
  it("is never honored on the production site, and is on dev servers and Vercel previews", () => {
    expect(phaseQueryAllowed("production", undefined)).toBe(false);
    expect(phaseQueryAllowed("production", "production")).toBe(false);
    expect(phaseQueryAllowed("production", "preview")).toBe(true);
    expect(phaseQueryAllowed("development", undefined)).toBe(true);
  });
  it("is ignored when not allowed, and only accepts the four phases", () => {
    expect(phaseFromQuery("?phase=day", false)).toBeNull();
    expect(phaseFromQuery("?phase=day", true)).toBe("day");
    expect(phaseFromQuery("?a=1&phase=night", true)).toBe("night");
    expect(phaseFromQuery("?phase=noon", true)).toBeNull();
    expect(phaseFromQuery("?phase=daylight", true)).toBeNull();
    expect(bootScript(false)).not.toMatch(/location\.search/);
    expect(bootScript(true)).toMatch(/location\.search/);
  });
});

describe("D4 · the boot script (runs before first paint)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const run = (time: string, search = "", cookie = "") => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const set: Record<string, string> = {}, attrs: Record<string, string> = {}, landing: Record<string, string> = {};
    const el = { style: { setProperty: (k: string, v: string) => { set[k] = v; } }, setAttribute: (k: string, v: string) => { attrs[k] = v; },
      closest: () => ({ setAttribute: (k: string, v: string) => { landing[k] = v; } }) };
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "hall" ? el : null), cookie });
    vi.stubGlobal("location", { search });
    new Function(bootScript(search !== ""))();
    return { set, attrs, landing };
  };
  it("sets the same variables as the module for the visitor's local time", () => {
    for (const t of ["2026-10-08T03:00:00", "2026-10-08T06:30:00", "2026-10-08T12:00:00", "2026-10-08T18:10:00"]) {
      const d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
      const { set, attrs } = run(t);
      expect(set).toEqual(hallVars(cycleT(h), K).vars);
      expect(attrs["data-phase"]).toBe(phaseName(h));
    }
  });
  it("honors ?phase= only when built for a preview, and marks a signed-in visitor from Clerk's cookie", () => {
    expect(run("2026-10-08T12:00:00", "?phase=night").attrs["data-phase"]).toBe("night");
    expect(run("2026-10-08T12:00:00", "", "a=1; __client_uat=1728000000").landing["data-auth"]).toBe("in");
    expect(run("2026-10-08T12:00:00", "", "__client_uat=0").landing["data-auth"]).toBeUndefined();
  });
});

describe("D4 · motion and photosensitivity", () => {
  it("the one turn-on dip per window lasts under 400 ms; every later window change fades over 1.5 s or more", () => {
    const m = /@keyframes hall-win-on \{ 0% \{ opacity: 0; \} (\d+)% \{[^}]*\} (\d+)% \{[^}]*0\.25\)[^}]*\} (\d+)% \{/.exec(css)!;
    const dur = Number(/hall-win-on ([\d.]+)s/.exec(css)![1]) * 1000;
    expect(((Number(m[3]) - Number(m[1])) / 100) * dur).toBeLessThan(400);
    for (const d of css.matchAll(/\.hall__win(?:\.is-\w+)? \{[^}]*transition(?:-duration)?: (?:opacity )?([\d.]+)s/g)) expect(Number(d[1])).toBeGreaterThanOrEqual(1.5);
    expect(css).toMatch(/\.is-dim \{[^}]*transition-duration: 2\.2s/);
    expect(css).toMatch(/\.is-off \{[^}]*transition-duration: 1\.6s/);
  });
  it("lights spread out over seconds (staggered), never all at once", () => {
    const ds = windowTimings().map((t) => t.d).sort((a, b) => a - b);
    expect(ds.length).toBe(WINDOWS.length);
    expect(ds[ds.length - 1] - ds[0]).toBeGreaterThan(2);
    expect(Math.min(...windowTimings().map((t) => t.b))).toBeGreaterThanOrEqual(0.6);
  });
  it("each firefly pulse lasts over a second (at most one flash per second), and the canvas loop has stop conditions", () => {
    expect(life).toMatch(/f\.dur = 1\.1 \+ Math\.random\(\) \* 0\.9/);
    expect(life).toMatch(/if \(!ctx \|\| !ready \|\| !live\(\) \|\| ff < 0\.01\)/);
    expect(life).toMatch(/saveData/);
    expect(life).toMatch(/hardwareConcurrency \?\? 8\) > 4/);
    expect(life).toMatch(/document\.hidden/);
    expect(life).toMatch(/IntersectionObserver/);
    expect(life).not.toMatch(/useSound|SoundEngine/); // never the sound player
  });
  it("reduced motion: no push-in, sway, drift, twinkle, window life or fireflies", () => {
    const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toMatch(/\.hall__scene, \.hall__scene \* \{ animation: none !important; transition: none !important; \}/);
    expect(rm).toMatch(/\.hall__fireflies \{ display: none; \}/);
    expect(life).toMatch(/if \(!reduce\) later\(life/);
    expect(css).toMatch(/\.hall__win \{[^}]*opacity: var\(--b\);/); // lit at their final state without animation
  });
  it("the scene never takes clicks, animates only transform and opacity, and pauses off-screen", () => {
    expect(css).toMatch(/\.hall__scene \{[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.hall__scene \* \{ pointer-events: none; \}/);
    for (const k of css.matchAll(/@keyframes [\w-]+ \{([^@]*?)\}\s*\}?/g)) expect(k[1], k[0]).not.toMatch(/\b(left|top|width|height|filter|background)\s*:/);
    expect(css).toMatch(/\.hall\[data-paused\] \.hall__scene \*[^{]*\{ animation-play-state: paused !important; \}/);
    expect(readFileSync("app/landing/hall/hall.tsx", "utf8")).toMatch(/data-ambient/);
  });
});

describe("D4 → D5 · glass", () => {
  it("two materials, one recipe: Liquid (lens where supported) and Frosted, with the rim and a solid fallback", () => {
    expect(glass).toMatch(/:root\[data-glass="frost"\] \{[^}]*--glass-blur: 26px;/);
    expect(glass).toMatch(/@supports \(backdrop-filter: url\(#a\)\)/); // Liquid's lens only where supported
    expect(glass).toMatch(/feTurbulence/); // Frosted grain
    expect(glass).toMatch(/mask-composite: exclude/); // the lit rim
    expect(glass).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(glass).not.toMatch(/border-image/);
    expect(readFileSync("app/layout.tsx", "utf8")).toMatch(/import "\.\/styles\/glass\.css";/);
  });
  it("on the Hall, text on glass keeps 4.5:1 even over a pure white backdrop (the Hall's shade floor)", () => {
    const shade = Number(/\.hall \.ui-glass \{ --glass-shade: calc\(([\d.]+) \+/.exec(css)![1]);
    const over = (bg: number, s: number) => { // white page under the shade, then the strongest part of the light fill (13% white)
      const c = bg * (1 - s) + 8 * s;
      const v = Math.round(c * 0.87 + 255 * 0.13);
      return `#${[v, v, v].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    };
    for (const text of ["#e8edf5", "#dfe7f6", "#d6deef"]) expect(contrast(text, over(255, shade)), text).toBeGreaterThanOrEqual(4.5);
  });
});

describe("D4 · assets", () => {
  it("first-load images stay under 250 KB; the firefly sheet is small and loads after idle", () => {
    const first = statSync("public/art/hall-1344.avif").size + statSync("public/art/hall-sky-mask.png").size + statSync("public/art/hall-foliage.avif").size;
    expect(first).toBeLessThan(250 * 1024);
    expect(statSync("public/art/fireflies-sheet.webp").size).toBeLessThan(40 * 1024);
    expect(life).toMatch(/requestIdleCallback/);
  });
  it("the firefly list matches the photo (about 36 glows, the soft bokeh orbs at 60 px or more)", () => {
    expect(FIREFLIES.boxes.length).toBeGreaterThanOrEqual(30);
    expect(FIREFLIES.boxes.length).toBeLessThanOrEqual(42);
    expect(FIREFLIES.boxes.filter(([, , w, h]) => w >= 60 && h >= 60).length).toBeGreaterThanOrEqual(3);
  });
  it("the landing makes no claim that the pictures are photographs, and credits say they are AI-generated", () => {
    expect(readFileSync("app/landing/hall/hall.tsx", "utf8")).not.toMatch(/photo(graph)? of|real photo/i);
    expect(readFileSync("app/credits/page.tsx", "utf8")).toMatch(/generated with AI, using\s+Higgsfield/);
    expect(readFileSync("docs/ASSETS.md", "utf8")).toMatch(/Higgsfield[\s\S]*2026-10-08/);
  });
});
