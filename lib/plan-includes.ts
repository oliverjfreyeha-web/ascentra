/**
 * What each plan opens for learning, in plain words, built from the rules' own numbers (never typed elsewhere):
 * courses (lib/progress/config.ts TRIAL_MODULES and TRIAL_BONUS_BEFORE_DAY), skill tracks (ROUNDS_BY_PLAN) and the
 * path picks (lib/picks/rules.ts SKILL_LIMIT_BASIC). Sent by GET /api/v1/billing and shown on Account → Billing, so
 * the page can't drift from the rules. Pure: tested in tests/unit/plan-includes.test.ts. Prices are not here: they
 * come from lib/billing-terms.ts.
 */
import { ROUNDS_BY_PLAN, TRACK_ROUNDS, TRIAL_BONUS_BEFORE_DAY, TRIAL_MODULES } from "@/lib/progress/config";
import { SKILL_LIMIT_BASIC } from "@/lib/picks/rules";

export type IncludesPlan = "trial" | "basic" | "pro";

const rounds = (n: number) =>
  n >= TRACK_ROUNDS ? `all ${TRACK_ROUNDS} Rounds` : n === 1 ? "Round 1" : n === 2 ? "Rounds 1 and 2" : `Rounds 1 to ${n}`;
const modules = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(n === 2 ? " and " : ", ");

// Every module opens in order; the last ones (the rank gates) also need a rank (lib/progress/rules.ts).
const COURSES_ALL = "Courses: every module, opening in order as you finish the one before (the last ones also need a rank).";
// The same words as Choose your path (lib/picks/picks.ts planNote).
const PICKS_LIMITED = `Up to ${SKILL_LIMIT_BASIC} skills (you can swap them), 1 business and, if you like, 1 side hustle. Once chosen, each one is locked; only the Owner can change it.`;

export function planIncludes(plan: IncludesPlan): string[] {
  if (plan === "trial") {
    return [
      `Courses: modules ${modules(TRIAL_MODULES)}. In a Standard or Large course, finishing both before day ${TRIAL_BONUS_BEFORE_DAY} also opens the first half of module ${TRIAL_MODULES + 1}.`,
      "Skill tracks: the first half of Round 1.",
      PICKS_LIMITED,
    ];
  }
  if (plan === "basic") {
    return [
      COURSES_ALL,
      `Skill tracks: ${rounds(ROUNDS_BY_PLAN.basic)}.`,
      PICKS_LIMITED,
    ];
  }
  return [
    `${COURSES_ALL} Past courses stay viewable.`,
    `Skill tracks: ${rounds(ROUNDS_BY_PLAN.pro)}.`,
    "As many skills as you like, one business and one side hustle at a time. You can switch either; your progress is kept.",
  ];
}

export const PLAN_INCLUDES = { trial: planIncludes("trial"), basic: planIncludes("basic"), pro: planIncludes("pro") } as const;
