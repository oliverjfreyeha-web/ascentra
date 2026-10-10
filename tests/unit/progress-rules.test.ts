/**
 * C2: the unlock rules, the trial bonus, ranks, the streak and quiz scores (lib/progress/rules.ts), including the edge
 * cases: 3, 4, 5 and 8-module courses, day 13 vs day 14, and a downgrade after the bonus.
 */
import { describe, expect, it } from "vitest";
import { GATE_RANKS, IMPORTANCE, QUIZ_PASS, RANKS } from "@/lib/progress/config";
import {
  courseComplete, earnsTrialBonus, gatedCount, isGated, itemOpen, notebookCategory, pointsFor, quizScore, rankOf, requiredRank, streaks,
  trialDay, unlockModules, type ModuleInput, type PlanKind,
} from "@/lib/progress/rules";
import type { SizeTier } from "@/lib/courses/structure";

/** n modules of `items` items, the first `done[i]` items of module i done; each item worth 2 points. */
const course = (n: number, done: number[] = [], items = 6): ModuleInput[] =>
  Array.from({ length: n }, (_, i) => ({ position: i + 1, items, points: items * 2, done: Array.from({ length: items }, (_, k) => k < (done[i] ?? 0)) }));
const states = (tier: SizeTier, plan: PlanKind, mods: ModuleInput[], rank = 10, bonus = false) =>
  unlockModules({ tier, plan, modules: mods, rank, bonus }).map((u) => `${u.state}${u.state === "half" ? `:${u.openItems}` : ""}`);

describe("rank gates", () => {
  it("gate the last half of the modules, rounded up, at most 4", () => {
    expect([3, 4, 5, 6, 7, 8, 9].map(gatedCount)).toEqual([2, 2, 3, 3, 4, 4, 4]);
    expect([1, 2, 3].map((p) => isGated(p, 3))).toEqual([false, true, true]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => isGated(p, 8))).toEqual([false, false, false, false, true, true, true, true]);
  });
  it("never ask for more rank than the course's earlier modules give", () => {
    const mods = course(5);
    expect(requiredRank(3, mods)).toBe(Math.min(GATE_RANKS[0], rankOf(24).index));
    const tiny = course(5, [], 1);
    expect(requiredRank(3, tiny)).toBe(1);
  });
});

describe("unlock rules (a paid plan)", () => {
  it("module 1 is open from the start; nothing else until half of module 1 is done", () => {
    expect(states("standard", "basic", course(5))).toEqual(["open", "locked", "locked", "locked", "locked"]);
  });
  it("half of module N done opens the first half of module N+1 (rounded up); all of it opens N+1 fully", () => {
    expect(states("standard", "basic", course(6, [3]))).toEqual(["open", "half:3", "locked", "locked", "locked", "locked"]);
    expect(states("standard", "basic", course(6, [6]))).toEqual(["open", "open", "locked", "locked", "locked", "locked"]);
    expect(states("standard", "basic", course(6, [6, 3], 5).map((m, i) => (i === 1 ? { ...m, done: [true, true, true, false, false] } : m)))).toEqual(["open", "open", "half:3", "locked", "locked", "locked"]);
  });
  it("a 3-module course: modules 2 and 3 are gated: never half, open when the previous is done and the rank is met", () => {
    expect(states("compact", "basic", course(3, [3]))).toEqual(["open", "locked", "locked"]);
    expect(states("compact", "basic", course(3, [6]))).toEqual(["open", "open", "locked"]);
    expect(states("compact", "basic", course(3, [6]), 1)).toEqual(["open", "locked", "locked"]);
    const u = unlockModules({ tier: "compact", plan: "basic", modules: course(3, [6]), rank: 1, bonus: false })[1];
    expect(u.reason).toMatch(/Opens when you reach the .* rank/);
  });
  it("a 4-module course: module 2 half-opens; 3 and 4 are gated", () => {
    expect(states("compact", "basic", course(4, [3]))).toEqual(["open", "half:3", "locked", "locked"]);
    expect(states("compact", "basic", course(4, [6, 3]))).toEqual(["open", "open", "locked", "locked"]);
    expect(states("compact", "basic", course(4, [6, 6]))).toEqual(["open", "open", "open", "locked"]);
  });
  it("a 5-module course: 3, 4 and 5 are gated", () => {
    expect(states("standard", "pro", course(5, [6, 6, 3]))).toEqual(["open", "open", "open", "locked", "locked"]);
    expect(states("standard", "pro", course(5, [6, 6, 6, 6]))).toEqual(["open", "open", "open", "open", "open"]);
  });
  it("an 8-module course: 1 to 4 half-open in turn; 5 to 8 are gated", () => {
    expect(states("large", "basic", course(8, [6, 6, 6, 3]))).toEqual(["open", "open", "open", "open", "locked", "locked", "locked", "locked"]);
    expect(states("large", "basic", course(8, [6, 6, 3]))).toEqual(["open", "open", "open", "half:3", "locked", "locked", "locked", "locked"]);
  });
  it("no plan: nothing; full access (the Owner): everything", () => {
    expect(states("standard", "none", course(5))).toEqual(["locked", "locked", "locked", "locked", "locked"]);
    expect(states("standard", "full", course(5))).toEqual(["open", "open", "open", "open", "open"]);
  });
  it("open items are the first ones in order", () => {
    const u = unlockModules({ tier: "standard", plan: "basic", modules: course(5, [3], 5), rank: 10, bonus: false })[1];
    expect([0, 1, 2, 3, 4].map((i) => itemOpen(u, i))).toEqual([true, true, true, false, false]);
  });
});

describe("the trial", () => {
  it("gets modules 1 and 2 (module 2 by the half-open rule, even when gated); nothing after", () => {
    expect(states("standard", "trial", course(5, [6, 6, 6]))).toEqual(["open", "open", "locked", "locked", "locked"]);
    expect(states("compact", "trial", course(3, [3]))).toEqual(["open", "half:3", "locked"]);
  });
  it("earns the bonus with modules 1 and 2 fully done before day 14 (day 13 yes, day 14 no), Standard and Large only", () => {
    const start = new Date("2026-10-01T12:00:00Z");
    const done = course(5, [6, 6]);
    const at = (d: number) => new Date(start.getTime() + (d - 1) * 86_400_000 + 3_600_000);
    expect([trialDay(start, at(13)), trialDay(start, at(14))]).toEqual([13, 14]);
    expect(earnsTrialBonus({ tier: "standard", plan: "trial", modules: done, trialStart: start, now: at(13) })).toBe(true);
    expect(earnsTrialBonus({ tier: "standard", plan: "trial", modules: done, trialStart: start, now: at(14) })).toBe(false);
    expect(earnsTrialBonus({ tier: "large", plan: "trial", modules: course(8, [6, 6]), trialStart: start, now: at(5) })).toBe(true);
    expect(earnsTrialBonus({ tier: "compact", plan: "trial", modules: course(4, [6, 6]), trialStart: start, now: at(5) })).toBe(false);
    expect(earnsTrialBonus({ tier: "standard", plan: "trial", modules: course(5, [6, 5]), trialStart: start, now: at(5) })).toBe(false);
    expect(earnsTrialBonus({ tier: "standard", plan: "basic", modules: done, trialStart: start, now: at(5) })).toBe(false);
  });
  it("the bonus opens the first half of module 3 over its rank gate; the other half by the normal rules", () => {
    expect(states("standard", "trial", course(5, [6, 6]), 1, true)).toEqual(["open", "open", "half:3", "locked", "locked"]);
    // After converting to Basic: kept, even while the rank gate is not met.
    expect(states("standard", "basic", course(5, [6, 6]), 1, true)).toEqual(["open", "open", "half:3", "locked", "locked"]);
    // The normal rules open the rest when module 2 is done and the rank is met.
    expect(states("standard", "basic", course(5, [6, 6]), 10, true)).toEqual(["open", "open", "open", "locked", "locked"]);
  });
  it("a downgrade after the bonus (Pro to Basic) keeps it; a Compact course never has it", () => {
    expect(states("standard", "basic", course(6, [6, 6]), 1, true)).toEqual(["open", "open", "open", "locked", "locked", "locked"]);
    expect(states("standard", "basic", course(5, [6, 6]), 1, true)[2]).toBe("half:3");
    // In a Large course module 3 isn't gated: it opens fully once module 2 is done, bonus or not.
    expect(states("large", "basic", course(8, [6, 6]), 1, true)[2]).toBe("open");
    expect(states("compact", "basic", course(4, [6, 6]), 1, true)[2]).toBe("locked");
    expect(states("compact", "trial", course(4, [6, 6]), 1, true)[2]).toBe("locked");
  });
});

describe("ranks and points", () => {
  it("uses exactly the ten names in order, each needing more points than the last", () => {
    expect(RANKS.map((r) => r.name)).toEqual(["Initiate", "Explorer", "Builder", "Operator", "Strategist", "Closer", "Architect", "Trailblazer", "FINAL FOUNDER", "Ascendant"]);
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i].points).toBeGreaterThan(RANKS[i - 1].points);
    expect(rankOf(0)).toMatchObject({ index: 1, name: "Initiate", next: { name: "Explorer" } });
    expect(rankOf(RANKS[9].points)).toMatchObject({ index: 10, name: "Ascendant", next: null });
    expect(rankOf(RANKS[8].points).name).toBe("FINAL FOUNDER");
  });
  it("weighs items by their importance: 1, 2 or 3 points", () => {
    expect([pointsFor("should_know"), pointsFor("important"), pointsFor("very_important")]).toEqual([1, 2, 3]);
    expect(IMPORTANCE.very_important.label).toBe("Very important");
  });
  it("a full Large course and its capstone are about what Ascendant needs (the starter curve)", () => {
    const large = 9 * 12 * 2 + 40;
    expect(rankOf(large - 40).index).toBeLessThan(10);
    expect(rankOf(large).index).toBeGreaterThanOrEqual(9);
  });
});

describe("the streak", () => {
  it("counts a run ending today or yesterday; a missed full day resets it to 0; keeps the longest", () => {
    expect(streaks(["2026-10-08", "2026-10-09", "2026-10-10"], "2026-10-10")).toEqual({ current: 3, longest: 3 });
    expect(streaks(["2026-10-08", "2026-10-09"], "2026-10-10")).toEqual({ current: 2, longest: 2 });
    expect(streaks(["2026-10-07", "2026-10-08"], "2026-10-10")).toEqual({ current: 0, longest: 2 });
    expect(streaks(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-10-09", "2026-10-10", "2026-10-10"], "2026-10-10")).toEqual({ current: 2, longest: 4 });
    expect(streaks([], "2026-10-10")).toEqual({ current: 0, longest: 0 });
  });
  it("crosses month and year ends", () => {
    expect(streaks(["2026-12-30", "2026-12-31", "2027-01-01"], "2027-01-01")).toEqual({ current: 3, longest: 3 });
  });
});

describe("quizzes, completion, the Notebook", () => {
  it("scores matching and ordering by position; passes at 80%", () => {
    expect(quizScore("ordering", { order: [0, 1, 2, 3, 4] }, { order: [0, 1, 2, 3, 0] }, false)).toBe(0.8);
    expect(quizScore("matching", { pairs: [0, 1, 2] }, { pairs: [1, 0, 2] }, false)).toBeCloseTo(1 / 3);
    expect(quizScore("multiple_choice", { correct: 1 }, { choice: 0 }, false)).toBe(0);
    expect(quizScore("multiple_choice", { correct: 1 }, { choice: 1 }, true)).toBe(1);
    expect(QUIZ_PASS).toBe(0.8);
  });
  it("a course is complete only with every module done and the capstone done", () => {
    expect(courseComplete(course(3, [6, 6, 6]), false)).toBe(false);
    expect(courseComplete(course(3, [6, 6, 5]), true)).toBe(false);
    expect(courseComplete(course(3, [6, 6, 6]), true)).toBe(true);
  });
  it("files notes by kind", () => {
    expect(notebookCategory("video", null, null)).toBe("videos");
    expect(notebookCategory("activity", "quiz", "flashcard")).toBe("key_terms");
    expect(notebookCategory("activity", "quiz", "multiple_choice")).toBe("quizzes");
    expect(notebookCategory("activity", "assignment", "short_answer")).toBe("assignments");
    expect(notebookCategory("activity", "sandbox", "build_it")).toBe("tasks");
  });
});
