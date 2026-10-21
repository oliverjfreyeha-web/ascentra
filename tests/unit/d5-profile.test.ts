/**
 * Design rebuild D5 · The 365-day points read (the one allowed change outside design: read-only, no SQL, same route and
 * permission) and the Profile dashboard's pure parts: real numbers only, points per day (never minutes), the rank as a
 * named tier (never a position), the course map's states, the saved widget choice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POINTS_WINDOW_DAYS, pointsWindow, streaks } from "@/lib/progress/rules";
import { RANKS } from "@/lib/progress/config";
import { cells, cellText, courseMap, ladder, lastDays, levelOf, overall, sparkline, yearStart } from "@/app/learn/progress/profile/profile-data";
import { readHiddenWidgets, writeHiddenWidgets, WIDGETS_KEY } from "@/app/env/prefs";
import type { MyProgress, ProgressCourse, ProgressModule } from "@/app/progress-api";

const day = (s: string, d: number) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const TODAY = "2026-10-19";

describe("D5 · the 365-day points read", () => {
  const byDay = new Map<string, number>([[day(TODAY, -400), 9], [day(TODAY, -365), 8], [day(TODAY, -364), 7], [day(TODAY, -29), 5], [day(TODAY, -30), 4], [TODAY, 3], [day(TODAY, 1), 2]]);
  it("returns the last 365 calendar days ending today, oldest first, only days with points", () => {
    expect(POINTS_WINDOW_DAYS).toBe(365);
    expect(pointsWindow(byDay, TODAY)).toEqual([
      { day: day(TODAY, -364), points: 7 }, { day: day(TODAY, -30), points: 4 }, { day: day(TODAY, -29), points: 5 }, { day: TODAY, points: 3 },
    ]);
  });
  it("reaches back further than the old 30 days (it was the last 30 days with points)", () => {
    const many = new Map(Array.from({ length: 200 }, (_, i) => [day(TODAY, -i), 1] as const));
    expect(pointsWindow(many, TODAY)).toHaveLength(200);
    expect(pointsWindow(many, TODAY, 30)).toHaveLength(30);
  });
  it("is computed in TypeScript from the completions already read: no SQL, same route and permission", () => {
    const learner = readFileSync("lib/progress/learner.ts", "utf8");
    expect(learner).toMatch(/pointsByDay: pointsWindow\(pointsByDay, today\)/);
    expect(learner).not.toMatch(/\.slice\(-30\)\.map\(\(\[day, points\]\)/);
    expect(learner).toMatch(/from\("item_completions"\)\.select\("course_id, points, local_day, completed_at"\)\.eq\("account_id", actor\.id\)/);
    expect(readFileSync("app/api/v1/learn/progress/route.ts", "utf8")).toMatch(/withCap\("learn"/);
  });
  it("My progress keeps showing the last 30 days with points in its own list", () => {
    expect(readFileSync("app/learn/progress/progress-view.tsx", "utf8")).toMatch(/const recent = p\.pointsByDay\.slice\(-30\);/);
  });
});

const mod = (position: number, state: ProgressModule["state"], doneCount: number, itemCount: number, round: number | null = null): ProgressModule =>
  ({ position, title: `S${position}`, state, reason: state === "locked" ? "Opens later." : null, gated: false, done: doneCount === itemCount, doneCount, itemCount, round });
const course = (o: Partial<ProgressCourse>): ProgressCourse => ({
  courseId: "c", slug: "s", name: "Course", kind: "skill", pickStatus: "active", tier: null, plan: "basic", percent: 0, done: 0, items: 0,
  complete: false, bonus: false, capstone: null, points: 0, skillRank: null, modules: [], track: null, ...o,
});
const prog = (o: Partial<MyProgress>): MyProgress => ({
  rank: { index: 2, name: "Explorer", points: 14, next: { name: "Builder", needs: 11 } }, streak: { current: 3, longest: 6 }, plan: "basic",
  courses: [], pastCourses: [], skills: [], scores: [], pointsByDay: [], timeZone: "UTC", note: "", pointsFor: { shouldKnow: 1, important: 2, veryImportant: 3 }, ...o,
});

describe("D5 · Profile numbers come only from the real progress", () => {
  it("overall progress counts active courses; nothing when there is nothing to count", () => {
    expect(overall(prog({}))).toBeNull();
    expect(overall(prog({ courses: [course({ done: 3, items: 12 }), course({ done: 6, items: 16 }), course({ done: 9, items: 9, pickStatus: "paused" })] }))).toEqual({ done: 9, items: 28, percent: 32 });
  });
  it("the last 7 days and the sparkline come from points per day; no history, no sparkline", () => {
    const p = prog({ pointsByDay: [{ day: day(TODAY, -2), points: 4 }, { day: TODAY, points: 6 }] });
    expect(lastDays(p, TODAY).map((d) => d.points)).toEqual([0, 0, 0, 0, 4, 0, 6]);
    expect(sparkline(p, TODAY)).toMatchObject({ total: 10, todayPoints: 6 });
    expect(sparkline(prog({}), TODAY)).toBeNull();
  });
  it("activity levels by points; a day with none right after a day with points is the day the streak reset", () => {
    expect([levelOf(0, 0, false), levelOf(0, 5, false), levelOf(0, 5, true), levelOf(1, 0, false), levelOf(3, 0, false), levelOf(6, 0, false), levelOf(10, 0, false)])
      .toEqual(["rest", "miss", "rest", "short", "steady", "focus", "grind"]);
    // Consistent with the server's streak rule: the "missed" day is the one that broke the run.
    expect(streaks([day(TODAY, -3), day(TODAY, -2)], TODAY).current).toBe(0);
  });
  it("the year view has 365 days, each labelled in points, never minutes", () => {
    const p = prog({ pointsByDay: [{ day: TODAY, points: 4 }] });
    const year = cells(p, TODAY, yearStart(TODAY));
    expect(year).toHaveLength(365);
    expect(year[364]).toMatchObject({ day: TODAY, points: 4, today: true });
    const text = year.map(cellText).join(" ");
    expect(text).toMatch(/4 points · Steady/);
    expect(text).not.toMatch(/\bmin(ute)?s?\b|\bh\b/);
  });
  it("the rank is a ladder of the named tiers with the learner's own marked: never a position", () => {
    const l = ladder(prog({}));
    expect(l.map((s) => s.name)).toEqual(RANKS.map((r) => r.name));
    expect(l.filter((s) => s.current).map((s) => s.name)).toEqual(["Explorer"]);
    expect(l.filter((s) => s.reached)).toHaveLength(2);
  });
  it("the course map: one branch per active course, real sections, done / now / next / locked", () => {
    const b = courseMap(prog({ courses: [course({ slug: "a", modules: [mod(1, "open", 2, 2), mod(2, "open", 0, 2), mod(3, "half", 0, 2), mod(4, "locked", 0, 2)] }), course({ slug: "p", pickStatus: "paused", modules: [mod(1, "open", 0, 1)] })] }));
    expect(b).toHaveLength(1);
    expect(b[0].nodes.map((n) => n.state)).toEqual(["done", "now", "next", "locked"]);
    expect(b[0].href).toBe("/learn");
    expect(courseMap(prog({}))).toEqual([]);
  });
});

describe("D5 · the widget choice is kept with the other preferences", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  it("saves and reads hidden widgets; ignores junk; never throws", () => {
    const s = mem();
    expect(readHiddenWidgets(s)).toEqual([]);
    expect(writeHiddenWidgets(["map", "streak"], s)).toBe(true);
    expect(readHiddenWidgets(s)).toEqual(["streak", "map"]);
    s.setItem(WIDGETS_KEY, '["trophies","globe",5]');
    expect(readHiddenWidgets(s)).toEqual(["globe"]);
    s.setItem(WIDGETS_KEY, "{not json");
    expect(readHiddenWidgets(s)).toEqual([]);
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readHiddenWidgets(boom)).toEqual([]);
    expect(writeHiddenWidgets(["map"], boom)).toBe(false);
  });
});
