/**
 * Design rebuild D4 · The pure parts of Home and the Library: which course, Round and next section Home shows (only
 * from the real progress answer, nothing invented), and the Library's counts, status and search.
 */
import { describe, expect, it } from "vitest";
import { homeView } from "@/app/home-progress";
import { courseCounts, matchesQuery } from "@/app/learn/learn-list";
import type { MyProgress, ProgressCourse, ProgressModule } from "@/app/progress-api";
import type { LearnerCourse } from "@/app/courses-api";

const mod = (position: number, state: ProgressModule["state"], doneCount: number, itemCount: number, round: number | null = null): ProgressModule =>
  ({ position, title: `Section ${position}`, state, reason: null, gated: false, done: doneCount === itemCount, doneCount, itemCount, round });
const course = (o: Partial<ProgressCourse>): ProgressCourse => ({
  courseId: "c", slug: "s", name: "Course", kind: "skill", pickStatus: "active", tier: null, plan: "basic", percent: 0, done: 0, items: 0,
  complete: false, bonus: false, capstone: null, points: 0, skillRank: null, modules: [], track: null, ...o,
});
const progress = (courses: ProgressCourse[]) => ({ courses } as unknown as MyProgress);

describe("D4 · Home", () => {
  it("a module course: all its modules, the first open unfinished one is next, and Continue goes to /learn", () => {
    const v = homeView(progress([course({ modules: [mod(1, "open", 2, 2), mod(2, "half", 0, 3), mod(3, "locked", 0, 2)] })]))!;
    expect(v.sections).toHaveLength(3);
    expect(v.next?.position).toBe(2);
    expect(v.href).toBe("/learn");
    expect(v.round).toBeNull();
  });
  it("a skill track: the current Round is the first open one not complete; Continue goes to the track", () => {
    const v = homeView(progress([course({
      slug: "copy", modules: [mod(1, "open", 1, 1, 1), mod(2, "open", 1, 1, 1), mod(1, "open", 0, 2, 2), mod(2, "locked", 0, 2, 2)],
      track: { rounds: [{ round: 1, state: "open", reason: null, complete: true, doneCount: 2, itemCount: 2 }, { round: 2, state: "open", reason: null, complete: false, doneCount: 0, itemCount: 4 }, { round: 3, state: "locked", reason: "Pro", complete: false, doneCount: 0, itemCount: 4 }] },
    })]))!;
    expect(v.round?.round).toBe(2);
    expect(v.roundCount).toBe(3);
    expect(v.sections.map((m) => m.round)).toEqual([2, 2]);
    expect(v.next?.position).toBe(1);
    expect(v.href).toBe("/learn/track/copy");
  });
  it("skips finished and paused courses; nothing at all when there is no active course", () => {
    expect(homeView(progress([course({ complete: true }), course({ pickStatus: "paused" })]))).toBeNull();
    expect(homeView(progress([]))).toBeNull();
    expect(homeView(progress([course({ name: "Done", complete: true }), course({ name: "Now" })]))?.course.name).toBe("Now");
  });
  it("no Up next when everything left is locked", () => {
    expect(homeView(progress([course({ modules: [mod(1, "open", 1, 1), mod(2, "locked", 0, 2)] })]))?.next).toBeNull();
  });
});

describe("D4 · Library", () => {
  const lc = (done: boolean[]): LearnerCourse => ({ slug: "x", name: "Cold outreach", version: 1, modules: [{ title: "Cold email", lessons: done.map((d, i) => ({ id: `${i}`, title: i ? "One small ask" : "Hooks", minutes: 5, lastVerifiedOn: null, done: d, updated: false })) }] });
  it("counts and status from the lessons' own done flags", () => {
    expect(courseCounts(lc([false, false]))).toEqual({ modules: 1, lessons: 2, done: 0, status: "new" });
    expect(courseCounts(lc([true, false]))).toMatchObject({ done: 1, status: "taking" });
    expect(courseCounts(lc([true, true]))).toMatchObject({ done: 2, status: "done" });
    expect(courseCounts({ ...lc([]), modules: [] })).toMatchObject({ lessons: 0, status: "new" });
  });
  it("search matches the course, a module or a lesson, ignoring case", () => {
    expect(matchesQuery(lc([false]), "")).toBe(true);
    expect(matchesQuery(lc([false]), "COLD OUT")).toBe(true);
    expect(matchesQuery(lc([false]), "cold email")).toBe(true);
    expect(matchesQuery(lc([false, false]), "small ask")).toBe(true);
    expect(matchesQuery(lc([false]), "video")).toBe(false);
  });
});
