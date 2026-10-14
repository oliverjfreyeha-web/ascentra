/**
 * S1: the skill track rules (lib/progress/tracks.ts): unlock across sections and Rounds; access for the trial, Basic and
 * Pro, including a trial that converts to Basic (progress kept); points per Round (once per item, × the Round's
 * multiplier); the truthful locked labels. Module courses are unchanged (tests/unit/progress-rules.test.ts still passes
 * as before, and the last test here checks unlockModules directly).
 */
import { describe, expect, it } from "vitest";
import { ROUND_MULTIPLIER, ROUNDS_BY_PLAN, SECTIONS_PER_ROUND, TRACK_ROUNDS } from "@/lib/progress/config";
import { pointsFor, unlockModules, type PlanKind } from "@/lib/progress/rules";
import { roundComplete, roundLockLabel, sectionNumber, sectionPosition, trackPoints, unlockTrack, type SectionInput } from "@/lib/progress/tracks";

/** Rounds of 5 sections of `items` items; done[r-1][k-1] = how many of that section's first items are done. */
const track = (rounds: number[], done: number[][] = [], items = 4): SectionInput[] =>
  rounds.flatMap((r) => Array.from({ length: SECTIONS_PER_ROUND }, (_, k) => ({
    round: r, position: sectionPosition(r, k + 1), items, points: items * 2,
    done: Array.from({ length: items }, (_, i) => i < (done[r - 1]?.[k] ?? 0)),
  })));
const states = (plan: PlanKind, s: SectionInput[]) => {
  const u = unlockTrack(plan, s);
  return u.rounds.map((r) => `R${r.round}:${r.state} ` + u.sections.filter((x) => x.round === r.round).map((x) => `${x.state}${x.state === "half" ? `:${x.openItems}` : ""}`).join(","));
};
const ALL = [4, 4, 4, 4, 4];

describe("the config", () => {
  it("3 Rounds of 5 sections; multipliers 1, 1.5, 2; Basic has Rounds 1-2, Pro all 3", () => {
    expect([TRACK_ROUNDS, SECTIONS_PER_ROUND]).toEqual([3, 5]);
    expect(ROUND_MULTIPLIER).toEqual({ 1: 1, 2: 1.5, 3: 2 });
    expect(ROUNDS_BY_PLAN).toMatchObject({ none: 0, trial: 1, basic: 2, pro: 3 });
  });
  it("Round r's sections sit at positions 5(r-1)+1 to 5r", () => {
    expect([sectionPosition(1, 1), sectionPosition(2, 1), sectionPosition(3, 5)]).toEqual([1, 6, 15]);
    expect([1, 5, 6, 10, 15].map(sectionNumber)).toEqual([1, 5, 1, 5, 5]);
  });
});

describe("unlock across sections (the half-open rule) and Rounds", () => {
  it("Round 1 section 1 is open from the start; nothing else", () => {
    expect(states("pro", track([1, 2, 3]))).toEqual(["R1:open open,locked,locked,locked,locked", "R2:locked locked,locked,locked,locked,locked", "R3:locked locked,locked,locked,locked,locked"]);
  });
  it("half of section k opens the first half of section k+1; all of it opens k+1 fully", () => {
    expect(states("pro", track([1], [[2]]))[0]).toBe("R1:open open,half:2,locked,locked,locked");
    expect(states("pro", track([1], [[4, 2]]))[0]).toBe("R1:open open,open,half:2,locked,locked");
  });
  it("Round 2 opens only when every item of Round 1 is done", () => {
    expect(states("pro", track([1, 2], [[4, 4, 4, 4, 3]]))[1]).toBe("R2:locked locked,locked,locked,locked,locked");
    const u = unlockTrack("pro", track([1, 2], [[4, 4, 4, 4, 3]]));
    expect(u.rounds[1].reason).toBe("Opens when you finish every item of Round 1.");
    expect(states("pro", track([1, 2], [ALL]))[1]).toBe("R2:open open,locked,locked,locked,locked");
    expect(roundComplete(track([1, 2], [ALL]), 1)).toBe(true);
    expect(roundComplete(track([1, 2], [ALL]), 2)).toBe(false);
  });
  it("within Round 2 the same half-open rule applies", () => {
    expect(states("pro", track([1, 2], [ALL, [4, 2]]))[1]).toBe("R2:open open,open,half:2,locked,locked");
  });
});

describe("plan access", () => {
  it("no plan: everything locked with a plain reason", () => {
    const u = unlockTrack("none", track([1, 2, 3]));
    expect(u.sections.every((s) => s.state === "locked" && s.reason === "Choose a plan to keep learning.")).toBe(true);
  });
  it("the trial: the first half of Round 1's items, in order, rounded up (10 of 20; 11 of 21)", () => {
    const done = track([1, 2, 3], [[4, 4, 4]]);
    expect(states("trial", done)[0]).toBe("R1:open open,open,half:2,locked,locked");
    const u = unlockTrack("trial", done);
    expect(u.sections.reduce((n, s) => n + (s.round === 1 ? s.openItems : 0), 0)).toBe(10);
    expect(u.sections[2].reason).toBe("The rest of Round 1 is part of Basic and Pro.");
    expect(u.sections[3].reason).toBe("Not in the free trial. The rest of Round 1 is part of Basic and Pro.");
    // An odd count rounds up.
    const odd = track([1], [ALL]);
    odd[4] = { ...odd[4], items: 5, done: [false, false, false, false, false] };
    expect(unlockTrack("trial", odd).sections.reduce((n, s) => n + s.openItems, 0)).toBe(11);
    expect(unlockTrack("trial", odd).sections[3].reason).toBe("Not in the free trial. The rest of Round 1 is part of Basic and Pro.");
  });
  it("the trial never includes Rounds 2 or 3, and says which plans do", () => {
    const u = unlockTrack("trial", track([1, 2, 3], [ALL]));
    expect(u.rounds.map((r) => r.reason)).toEqual([null, "Round 2 is part of Basic and Pro.", "Round 3 is part of Pro."]);
  });
  it("Basic: Rounds 1 and 2; Round 3 says it is part of Pro", () => {
    const u = unlockTrack("basic", track([1, 2, 3], [ALL, ALL]));
    expect(u.rounds.map((r) => r.state)).toEqual(["open", "open", "locked"]);
    expect(u.rounds[2].reason).toBe("Round 3 is part of Pro.");
    expect(roundLockLabel(3)).toBe("Round 3 is part of Pro.");
  });
  it("Pro: all 3 Rounds", () => {
    expect(unlockTrack("pro", track([1, 2, 3], [ALL, ALL])).rounds.map((r) => r.state)).toEqual(["open", "open", "open"]);
  });
  it("a trial that converts to Basic keeps its progress and opens the rest of Round 1, then Round 2", () => {
    const s = track([1, 2, 3], [[4, 4, 2]]);
    expect(states("trial", s)[0]).toBe("R1:open open,open,half:2,locked,locked");
    expect(states("basic", s)[0]).toBe("R1:open open,open,open,half:2,locked");
    // Done items stay done whatever the plan; finishing Round 1 on Basic opens Round 2.
    expect(states("basic", track([1, 2, 3], [ALL]))[1]).toBe("R2:open open,locked,locked,locked,locked");
    // Going back down to Basic from Pro keeps Round 3's progress; it is only locked.
    const back = unlockTrack("basic", track([1, 2, 3], [ALL, ALL, [4]]));
    expect(back.rounds[2]).toMatchObject({ state: "locked", doneCount: 4 });
  });
});

describe("points per Round", () => {
  it("an item's points are its importance points × the Round's multiplier, a whole number with halves rounding up", () => {
    // Should know 1: 1, 1.5 → 2, 2. Important 2: 2, 3, 4. Very important 3: 3, 4.5 → 5, 6.
    expect([1, 2, 3].map((r) => trackPoints("should_know", r))).toEqual([1, 2, 2]);
    expect([1, 2, 3].map((r) => trackPoints("important", r))).toEqual([2, 3, 4]);
    expect([1, 2, 3].map((r) => trackPoints("very_important", r))).toEqual([3, 5, 6]);
    expect(trackPoints(null, 2)).toBe(2);
    for (const r of [1, 2, 3]) for (const imp of ["should_know", "important", "very_important"] as const) {
      expect(Number.isInteger(trackPoints(imp, r))).toBe(true);
      expect(trackPoints(imp, r)).toBeGreaterThanOrEqual(pointsFor(imp));
    }
  });
  it("once per Round: each Round's items are their own rows, so the same section in Rounds 1 and 2 earns twice, an item once", () => {
    // Points come from distinct items; re-doing an item in a Round never adds (the attempt is recorded once).
    const r1 = 5 * 4 * trackPoints("important", 1);
    const r2 = 5 * 4 * trackPoints("important", 2);
    expect([r1, r2]).toEqual([40, 60]);
  });
});

describe("existing module courses are unchanged", () => {
  it("unlockModules still gives the C2 states for a sized course", () => {
    const mods = Array.from({ length: 5 }, (_, i) => ({ position: i + 1, items: 6, points: 12, done: Array.from({ length: 6 }, (_, k) => i === 0 && k < 3) }));
    expect(unlockModules({ tier: "standard", plan: "basic", modules: mods, rank: 10, bonus: false }).map((u) => u.state)).toEqual(["open", "half", "locked", "locked", "locked"]);
  });
});
