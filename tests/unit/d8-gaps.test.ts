/**
 * Design rebuild D8 · Unit tests for the gaps left after D1–D7 (the rest is already covered: preferences defaults,
 * invalid and old saved values and the boot script in env-prefs.test.ts; the lens controller in lens-core.test.ts;
 * activity levels, the 365-day window and the course map's states in d5-profile.test.ts).
 *   - The runtime attribute setter (applyPrefs, syncReduced, syncLite) that the Appearance controls call.
 *   - Saving and reading back every preference.
 *   - The activity grid's Week, Month and Year date ranges (month starts, leap years, year boundaries) and its level
 *     boundaries.
 *   - The course map's links and summaries.
 *   - design-reference/ stays out of lint, typecheck, tests and the app.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPrefs, DEFAULTS, EFFECTS, GLASSES, KEYS, MOTIONS, readPrefs, syncLite, syncReduced, THEMES, writePref, type Prefs } from "@/app/env/prefs";
import { cells, courseMap, firstOfMonth, levelOf, weekStart, yearStart } from "@/app/learn/progress/profile/profile-data";
import type { MyProgress, ProgressCourse, ProgressModule } from "@/app/progress-api";

/** A stand-in <html>, window and navigator for the setter: attributes in a map, events recorded. */
function fakeDom(o: { osReduce?: boolean; width?: number; cores?: number; saveData?: boolean; attrs?: Record<string, string> } = {}) {
  const attrs = new Map(Object.entries(o.attrs ?? {}));
  const events: unknown[] = [];
  const el = { setAttribute: (k: string, v: string) => void attrs.set(k, v), getAttribute: (k: string) => attrs.get(k) ?? null, hasAttribute: (k: string) => attrs.has(k) };
  vi.stubGlobal("document", { documentElement: el });
  vi.stubGlobal("navigator", { hardwareConcurrency: o.cores ?? 8, connection: { saveData: !!o.saveData } });
  vi.stubGlobal("window", { innerWidth: o.width ?? 1440, matchMedia: () => ({ matches: !!o.osReduce }), dispatchEvent: (e: CustomEvent) => void events.push(e.detail) });
  return { attrs, events };
}

describe("D8 · the runtime attribute setter (theme, glass, motion, reduced, lite)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applyPrefs writes theme, glass and motion to <html>, derives data-reduced and data-lite, and tells listeners", () => {
    const { attrs, events } = fakeDom();
    const p: Prefs = { ...DEFAULTS, theme: "mono", glass: "liquid", motion: "full" };
    applyPrefs(p);
    expect(Object.fromEntries(attrs)).toEqual({ "data-glass": "liquid", "data-motion": "full", "data-theme": "mono", "data-reduced": "0", "data-lite": "0" });
    expect(events).toEqual([p]);
    // Never writes data-scene (decision 1: the scenes are gone; a saved scene is read but not applied).
    expect(attrs.has("data-scene")).toBe(false);
  });

  it("every theme, glass and motion value lands as is; Reduced (stored 'simple') and Off turn data-reduced on", () => {
    for (const theme of THEMES) for (const glass of GLASSES) for (const motion of MOTIONS) {
      const { attrs } = fakeDom();
      applyPrefs({ ...DEFAULTS, theme, glass, motion });
      expect([attrs.get("data-theme"), attrs.get("data-glass"), attrs.get("data-motion")]).toEqual([theme, glass, motion]);
      expect(attrs.get("data-reduced"), motion).toBe(motion === "full" ? "0" : "1");
    }
  });

  it("syncReduced: the device setting and a slow device (data-motion-auto) also turn it on; junk motion counts as Full", () => {
    expect(fakeDom({ osReduce: true, attrs: { "data-motion": "full" } }) && (syncReduced(), document.documentElement.getAttribute("data-reduced"))).toBe("1");
    expect(fakeDom({ attrs: { "data-motion": "full", "data-motion-auto": "" } }) && (syncReduced(), document.documentElement.getAttribute("data-reduced"))).toBe("1");
    expect(fakeDom({ attrs: { "data-motion": "turbo" } }) && (syncReduced(), document.documentElement.getAttribute("data-reduced"))).toBe("0");
    expect(fakeDom({ attrs: {} }) && (syncReduced(), document.documentElement.getAttribute("data-reduced"))).toBe("0");
  });

  it("syncLite: phones, few cores and Save-Data are Lite unless effects are 'full'", () => {
    const lite = (o: Parameters<typeof fakeDom>[0], effects: (typeof EFFECTS)[number] = "auto") => { const { attrs } = fakeDom(o); syncLite(effects); return attrs.get("data-lite"); };
    expect(lite({ width: 390 })).toBe("1");
    expect(lite({ cores: 4 })).toBe("1");
    expect(lite({ saveData: true })).toBe("1");
    expect(lite({ width: 1440, cores: 8 })).toBe("0");
    expect(lite({ width: 390, cores: 2, saveData: true }, "full")).toBe("0");
  });
});

describe("D8 · preferences persist and read back", () => {
  it("every allowed value of every preference is saved and read back exactly; invalid writes leave the old value", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    for (const theme of THEMES) for (const glass of GLASSES) for (const motion of MOTIONS) for (const effects of EFFECTS) {
      for (const [k, v] of [["theme", theme], ["glass", glass], ["motion", motion], ["effects", effects]] as const) expect(writePref(k, v as never, s)).toBe(true);
      expect(readPrefs(s)).toEqual({ ...DEFAULTS, theme, glass, motion, effects });
    }
    expect(writePref("glass", "crystal" as never, s)).toBe(false);
    expect(m.get(KEYS.glass)).toBe(GLASSES[GLASSES.length - 1]);
    // The middle level is stored as "simple" (decision 4); the label "Reduced" is never stored.
    expect(writePref("motion", "reduced" as never, s)).toBe(false);
    expect(writePref("motion", "simple", s)).toBe(true);
    expect(m.get(KEYS.motion)).toBe("simple");
  });
});

const prog = (pointsByDay: { day: string; points: number }[], courses: ProgressCourse[] = []): MyProgress => ({
  rank: { index: 1, name: "Initiate", points: 0, next: { name: "Explorer", needs: 10 } }, streak: { current: 0, longest: 0 }, plan: "basic",
  courses, pastCourses: [], skills: [], scores: [], pointsByDay, timeZone: "UTC", note: "", pointsFor: { shouldKnow: 1, important: 2, veryImportant: 3 },
});

describe("D8 · activity grid ranges and levels", () => {
  it("Week is the last 7 days, Month starts on the 1st, Year is 365 days ending today", () => {
    expect(weekStart("2026-10-19")).toBe("2026-10-13");
    expect(firstOfMonth("2026-10-19")).toBe("2026-10-01");
    expect(yearStart("2026-10-19")).toBe("2025-10-20");
    const p = prog([]);
    expect(cells(p, "2026-10-19", weekStart("2026-10-19"))).toHaveLength(7);
    expect(cells(p, "2026-10-19", firstOfMonth("2026-10-19"))).toHaveLength(19);
    expect(cells(p, "2026-10-01", firstOfMonth("2026-10-01"))).toHaveLength(1); // the 1st itself
    expect(cells(p, "2026-10-19", yearStart("2026-10-19"))).toHaveLength(365);
  });
  it("ranges cross month, year and leap-day boundaries correctly", () => {
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
    expect(weekStart("2028-03-02")).toBe("2028-02-25");
    expect(cells(prog([]), "2028-03-02", weekStart("2028-03-02")).map((c) => c.day)).toContain("2028-02-29");
    expect(yearStart("2028-12-31")).toBe("2028-01-02"); // 2028 is a leap year: 365 days back stay inside it
    expect(yearStart("2026-03-01")).toBe("2025-03-02");
    expect(cells(prog([]), "2029-01-01", firstOfMonth("2029-01-01"))).toHaveLength(1);
    const year = cells(prog([]), "2028-12-31", yearStart("2028-12-31"));
    expect(year).toHaveLength(365);
    expect([year[0].day, year[364].day]).toEqual(["2028-01-02", "2028-12-31"]);
  });
  it("points outside the range never leak in; each day keeps its own points", () => {
    const p = prog([{ day: "2026-10-12", points: 9 }, { day: "2026-10-13", points: 4 }, { day: "2026-10-19", points: 2 }, { day: "2026-10-20", points: 7 }]);
    const week = cells(p, "2026-10-19", weekStart("2026-10-19"));
    expect(week.map((c) => c.points)).toEqual([4, 0, 0, 0, 0, 0, 2]);
    expect(week.at(-1)).toMatchObject({ today: true, day: "2026-10-19" });
  });
  it("levels change exactly at 1, 3, 6 and 10 points per day", () => {
    const at = (n: number) => levelOf(n, 0, false);
    expect([0, 1, 2, 3, 5, 6, 9, 10, 40].map(at)).toEqual(["rest", "short", "short", "steady", "steady", "focus", "focus", "grind", "grind"]);
  });
});

const mod = (position: number, state: ProgressModule["state"], done: boolean): ProgressModule =>
  ({ position, title: `S${position}`, state, reason: state === "locked" ? "Opens later." : null, gated: false, done, doneCount: done ? 2 : 0, itemCount: 2, round: null });
const course = (o: Partial<ProgressCourse>): ProgressCourse => ({
  courseId: "c", slug: "s", name: "Course", kind: "skill", pickStatus: "active", tier: null, plan: "basic", percent: 0, done: 0, items: 0,
  complete: false, bonus: false, capstone: null, points: 0, skillRank: null, modules: [], track: null, ...o,
});

describe("D8 · course map links and summaries", () => {
  it("a skill track links to its track page; other courses to /learn; one branch per active course, in order", () => {
    const b = courseMap(prog([], [
      course({ slug: "copywriting", name: "Copy", done: 2, items: 4, track: { rounds: [{ complete: true }, { complete: false }] } as unknown as ProgressCourse["track"], modules: [mod(1, "open", true), mod(2, "open", false)] }),
      course({ slug: "cold", name: "Cold", modules: [mod(1, "open", false)] }),
    ]));
    expect(b.map((x) => x.course.slug)).toEqual(["copywriting", "cold"]);
    expect(b[0].href).toBe("/learn/track/copywriting");
    expect(b[1].href).toBe("/learn");
    expect(b[0].nodes.map((n) => n.state)).toEqual(["done", "now"]);
    expect(b[0].summary).toBe("1 of 2 Rounds · 2 of 4 items");
    expect(b[1].summary).toBe("0 of 1 sections · 0 of 0 items");
  });
  it("a course with no sections has no branch; a finished course shows every section done", () => {
    expect(courseMap(prog([], [course({ modules: [] })]))).toEqual([]);
    const done = courseMap(prog([], [course({ modules: [mod(1, "open", true), mod(2, "open", true)] })]));
    expect(done[0].nodes.map((n) => n.state)).toEqual(["done", "done"]);
  });
});

describe("D8 · design-reference/ stays out of lint, typecheck, tests and the app", () => {
  it("eslint ignores it, tsconfig excludes it, and vitest and Playwright never look in it", () => {
    expect(readFileSync("eslint.config.mjs", "utf8")).toMatch(/globalIgnores\(\[[^\]]*"design-reference\/\*\*"/);
    expect(JSON.parse(readFileSync("tsconfig.json", "utf8")).exclude).toContain("design-reference");
    expect(readFileSync("vitest.config.mts", "utf8")).not.toMatch(/design-reference/);
    for (const f of readdirSync(".").filter((n) => /^playwright\..*config\.ts$/.test(n))) expect(readFileSync(f, "utf8"), f).not.toMatch(/design-reference/);
  });
  it("nothing in app/ or lib/ imports from it (so the build never includes it)", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css|mjs)$/.test(n) ? [p] : []; });
    for (const f of [...walk("app"), ...walk("lib")]) expect(readFileSync(f, "utf8"), f).not.toMatch(/from ["'][^"']*design-reference|import\(["'][^"']*design-reference|url\([^)]*design-reference/);
  });
});

describe("D8 · the visual baselines can't fail normal CI by accident", () => {
  it("they live in their own folder and config; the component config and CI never point at them", () => {
    expect(readFileSync("playwright.components.config.ts", "utf8")).toMatch(/testDir: "e2e\/components"/);
    expect(readFileSync("playwright.visual.config.ts", "utf8")).toMatch(/testDir: "e2e\/visual"/);
    for (const f of readdirSync(".github/workflows")) expect(readFileSync(join(".github/workflows", f), "utf8"), f).not.toMatch(/playwright\.visual|test:visual|e2e\/visual/);
    expect(readFileSync("vitest.config.mts", "utf8")).not.toMatch(/e2e/);
  });
  it("the spec skips itself unless the visual config turned it on; the scripts run and update it on demand", () => {
    expect(readFileSync("e2e/visual/design.visual.spec.ts", "utf8")).toMatch(/test\.skip\(!process\.env\.VISUAL_BASELINES/);
    expect(readFileSync("playwright.visual.config.ts", "utf8")).toMatch(/process\.env\.VISUAL_BASELINES = "1"/);
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["test:visual"]).toBe("playwright test -c playwright.visual.config.ts");
    expect(scripts["test:visual:update"]).toBe("playwright test -c playwright.visual.config.ts --update-snapshots");
    expect(scripts.test).toBe("vitest run");
  });
  it("every page, look and size has a baseline in the repo", () => {
    const have = new Set(readdirSync("e2e/visual/baselines"));
    for (const p of ["home", "library", "profile", "account", "admin"]) for (const l of ["iris-frost", "mono-frost", "iris-liquid"]) for (const w of [1280, 390]) expect(have.has(`${p}-${l}-${w}.png`), `${p}-${l}-${w}`).toBe(true);
  });
});
