/**
 * Account → Billing: what each plan opens for learning (lib/plan-includes.ts), checked against the rules themselves so
 * the page can't say more than a learner gets: the trial's course modules and bonus (lib/progress/rules.ts), the skill
 * track Rounds (lib/progress/tracks.ts) and the path picks (lib/picks/rules.ts). Also: the Access label no longer says
 * "Trial (Basic features)", which wasn't true for courses or skill tracks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_INCLUDES, planIncludes } from "@/lib/plan-includes";
import { ROUNDS_BY_PLAN, TRIAL_MODULES } from "@/lib/progress/config";
import { unlockModules, type ModuleInput } from "@/lib/progress/rules";
import { sectionPosition, unlockTrack, type SectionInput } from "@/lib/progress/tracks";
import { SKILL_LIMIT_BASIC, skillLimitOf } from "@/lib/picks/rules";

const course = (n: number, done = 6): ModuleInput[] =>
  Array.from({ length: n }, (_, i) => ({ position: i + 1, items: 6, points: 12, done: Array.from({ length: 6 }, (_, k) => k < done) }));
const track = (): SectionInput[] => [1, 2, 3].flatMap((r) => [1, 2, 3, 4, 5].map((k) => ({
  round: r, position: sectionPosition(r, k), items: 4, points: 8, done: [true, true, true, true],
})));

describe("what each plan includes", () => {
  it("the trial: course modules 1 and 2 (plus the bonus), the first half of Round 1, the Basic picks", () => {
    expect(planIncludes("trial")).toEqual([
      "Courses: modules 1 and 2. In a Standard or Large course, finishing both before day 14 also opens the first half of module 3.",
      "Skill tracks: the first half of Round 1.",
      "Up to 3 skills (you can swap them), 1 business and, if you like, 1 side hustle. Once chosen, each one is locked; only the Owner can change it.",
    ]);
    // The rules agree: on the trial, modules after the first two are locked, even when everything before is done.
    expect(unlockModules({ tier: "standard", plan: "trial", modules: course(5), rank: 10, bonus: false }).slice(TRIAL_MODULES).every((u) => u.state === "locked")).toBe(true);
    // And only half of Round 1's items open, even when all are done; Rounds 2 and 3 are locked.
    const t = unlockTrack("trial", track());
    expect(t.sections.filter((s) => s.round === 1).reduce((n, s) => n + s.openItems, 0)).toBe(10);
    expect(t.rounds.map((r) => r.state)).toEqual(["open", "locked", "locked"]);
  });

  it("Basic: every module (in order, with the rank gates), Rounds 1 and 2, the Basic picks", () => {
    expect(planIncludes("basic")).toEqual([
      "Courses: every module, opening in order as you finish the one before (the last ones also need a rank).",
      "Skill tracks: Rounds 1 and 2.",
      expect.stringMatching(/^Up to 3 skills/),
    ]);
    expect(ROUNDS_BY_PLAN.basic).toBe(2);
    expect(unlockTrack("basic", track()).rounds.map((r) => r.state)).toEqual(["open", "open", "locked"]);
    expect(unlockModules({ tier: "standard", plan: "basic", modules: course(5), rank: 10, bonus: false }).every((u) => u.state === "open")).toBe(true);
    expect(skillLimitOf("basic")).toBe(SKILL_LIMIT_BASIC);
  });

  it("Pro: every module, all 3 Rounds, unlimited skills", () => {
    expect(planIncludes("pro")).toEqual([
      "Courses: every module, opening in order as you finish the one before (the last ones also need a rank). Past courses stay viewable.",
      "Skill tracks: all 3 Rounds.",
      "As many skills as you like, one business and one side hustle at a time. You can switch either; your progress is kept.",
    ]);
    expect(unlockTrack("pro", track()).rounds.map((r) => r.state)).toEqual(["open", "open", "open"]);
    expect(skillLimitOf("pro")).toBeNull();
  });

  it("no income claims or prices in the lists (prices come from lib/billing-terms.ts)", () => {
    const all = Object.values(PLAN_INCLUDES).flat().join(" ");
    expect(all).not.toMatch(/\$|earn|income|guarantee/i);
  });

  it("the Access label says Free trial, never 'Trial (Basic features)'; the panel shows the server's lists", () => {
    const panel = readFileSync("app/account/billing-panel.tsx", "utf8");
    expect(panel).not.toMatch(/Basic features/);
    expect(panel).toMatch(/trial: "Free trial"/);
    expect(panel).toMatch(/data\.includes\[data\.tier\]/);
    expect(panel).toMatch(/data\.includes\[p\.key\]/);
  });
});
