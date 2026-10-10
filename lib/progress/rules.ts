/**
 * C2: the rules for moving through a course, as pure functions. The server decides every unlock state with these (the
 * page only shows them). Tested rule by rule in tests/unit/progress-rules.test.ts, including the edge cases.
 *
 * A module's items are its ordered list of videos, quizzes, assignments, sandboxes, sequences and boosters. An item is
 * done when a video is fully watched, a quiz scores at least QUIZ_PASS, or an assignment, task or sandbox is completed.
 *   Module 1: open from the start.
 *   Half-open: module N+1 opens its first half of items (rounded up) once half of module N's items are done.
 *   Fully open: module N+1 opens completely when module N is done.
 *   Rank gates: the last half of the modules (rounded up, at most 4) open only fully, when the previous module is done
 *     and the learner holds the required rank. Never half.
 *   Trial: modules 1 and 2 (module 2 by the half-open rule); nothing after, except the trial bonus.
 *   Trial bonus (Standard and Large only): a trial learner who finishes modules 1 and 2 (every item) before day 14 earns
 *     the first half of module 3, over its rank gate, kept after they convert. The other half opens by the normal rules.
 */
import { CAPSTONE_POINTS, GATE_MAX, GATE_RANKS, IMPORTANCE, QUIZ_PASS, RANKS, TRIAL_BONUS_BEFORE_DAY, TRIAL_MODULES, type Importance } from "./config";
import type { SizeTier } from "@/lib/courses/structure";

// ============ Points and ranks ============

export const pointsFor = (importance: Importance | null | undefined) => (importance ? IMPORTANCE[importance].points : IMPORTANCE.should_know.points);
export { CAPSTONE_POINTS };

/** The rank (1 to 10) for a number of points, with its name and what the next one needs. */
export function rankOf(points: number): { index: number; name: string; points: number; next: { name: string; needs: number } | null } {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (points >= RANKS[k].points) i = k;
  const next = RANKS[i + 1];
  return { index: i + 1, name: RANKS[i].name, points, next: next ? { name: next.name, needs: next.points - points } : null };
}
export const rankName = (index: number) => RANKS[Math.min(Math.max(index, 1), RANKS.length) - 1].name;

// ============ Items ============

/** A quiz attempt's score, 0 to 1: matching and ordering get credit for each right position; the rest are right or wrong. */
export function quizScore(type: string, key: Record<string, unknown> | null, answer: unknown, correct: boolean): number {
  if (correct) return 1;
  if (!key || !answer || typeof answer !== "object") return 0;
  const a = answer as Record<string, unknown>;
  const pairUp = (got: unknown, want: unknown) => {
    if (!Array.isArray(got) || !Array.isArray(want) || !want.length) return 0;
    return want.filter((w, i) => got[i] === w).length / want.length;
  };
  if (type === "matching") return pairUp(a.pairs, key.pairs);
  if (type === "ordering") return pairUp(a.order, key.order);
  return 0;
}
export const quizPassed = (score: number) => score >= QUIZ_PASS;

// ============ Unlock ============

export type ModuleState = "open" | "half" | "locked";
export type ModuleInput = { position: number; items: number; done: boolean[]; points: number };
export type PlanKind = "trial" | "basic" | "pro" | "full" | "none";
export type UnlockInput = {
  tier: SizeTier;
  plan: PlanKind;
  modules: ModuleInput[];
  /** The learner's overall rank index (1 to 10). */
  rank: number;
  /** An earned (or kept) trial bonus for this course. */
  bonus: boolean;
};
export type ModuleUnlock = {
  position: number; state: ModuleState; openItems: number; gated: boolean; requiredRank: number | null;
  reason: string | null; bonusHalf: boolean;
};

const half = (n: number) => Math.ceil(n / 2);
const doneCount = (m: ModuleInput) => m.done.filter(Boolean).length;
export const moduleDone = (m: ModuleInput) => m.items > 0 && doneCount(m) >= m.items;

/** How many of the last modules are rank-gated: half, rounded up, at most 4 (3 → 2, 5 → 3, 6 → 3, 8 → 4). */
export const gatedCount = (n: number) => Math.min(GATE_MAX, Math.ceil(n / 2));
export const isGated = (position: number, n: number) => position > n - gatedCount(n);

/**
 * The rank a gated module asks for: the configured rank for its gate order, but never more than the points of the
 * course's earlier modules give (so finishing them always meets it).
 */
export function requiredRank(position: number, modules: ModuleInput[]): number {
  const n = modules.length;
  const order = position - (n - gatedCount(n)) - 1;
  const configured = GATE_RANKS[Math.min(order, GATE_RANKS.length - 1)];
  const before = modules.filter((m) => m.position < position).reduce((s, m) => s + m.points, 0);
  return Math.max(1, Math.min(configured, rankOf(before).index));
}

/** Every module's state for this learner. */
export function unlockModules(input: UnlockInput): ModuleUnlock[] {
  const mods = [...input.modules].sort((a, b) => a.position - b.position);
  const n = mods.length;
  const out: ModuleUnlock[] = [];
  for (let i = 0; i < n; i++) {
    const m = mods[i];
    const gated = isGated(m.position, n);
    const need = gated ? requiredRank(m.position, mods) : null;
    const make = (state: ModuleState, reason: string | null, bonusHalf = false): ModuleUnlock =>
      ({ position: m.position, state, openItems: state === "open" ? m.items : state === "half" ? half(m.items) : 0, gated, requiredRank: need, reason, bonusHalf });
    if (input.plan === "none") { out.push(make("locked", "Choose a plan to keep learning.")); continue; }
    if (input.plan === "full") { out.push(make("open", null)); continue; }
    if (i === 0) { out.push(make("open", null)); continue; }
    const prev = mods[i - 1];
    const prevDone = moduleDone(prev);
    const prevHalf = doneCount(prev) >= half(prev.items);
    const trial = input.plan === "trial";

    // The normal rules.
    let normal: ModuleUnlock;
    if (gated && !(trial && i < TRIAL_MODULES)) {
      if (!prevDone) normal = make("locked", `Opens fully when you finish module ${prev.position}.`);
      else if (input.rank < need!) normal = make("locked", `Opens when you reach the ${rankName(need!)} rank (and module ${prev.position} is done).`);
      else normal = make("open", null);
    } else if (prevDone) normal = make("open", null);
    else if (prevHalf) normal = make("half", `The rest opens when you finish module ${prev.position}.`);
    else normal = make("locked", `Opens when you finish half of module ${prev.position}.`);

    // The trial: modules 1 and 2 only (module 2 by the half-open rule, its gate waived), and the bonus.
    if (trial && i >= TRIAL_MODULES) {
      if (i === TRIAL_MODULES && input.bonus && input.tier !== "compact") out.push(make("half", "Trial bonus: the first half is open. The rest opens on a plan.", true));
      else out.push(make("locked", "Not in the free trial. Choose a plan to open it."));
      continue;
    }
    // After the trial: an earned bonus keeps the first half of module 3 open whatever the gate.
    if (!trial && i === TRIAL_MODULES && input.bonus && input.tier !== "compact" && normal.state === "locked") {
      out.push(make("half", `Trial bonus: the first half is open. ${normal.reason ?? ""}`.trim(), true));
      continue;
    }
    out.push(normal);
  }
  return out;
}

/** Which items of a module are open: the first openItems in order. */
export const itemOpen = (u: ModuleUnlock, index: number) => index < u.openItems;

// ============ The trial bonus ============

/** The trial day (1 on the day the trial starts). */
export const trialDay = (trialStart: Date, now: Date) => Math.floor((now.getTime() - trialStart.getTime()) / 86_400_000) + 1;

/** Whether a trial learner earns the bonus now: Standard or Large, modules 1 and 2 fully done, before day 14. */
export function earnsTrialBonus(p: { tier: SizeTier; plan: PlanKind; modules: ModuleInput[]; trialStart: Date | null; now: Date }): boolean {
  if (p.plan !== "trial" || p.tier === "compact" || !p.trialStart) return false;
  if (trialDay(p.trialStart, p.now) >= TRIAL_BONUS_BEFORE_DAY) return false;
  const mods = [...p.modules].sort((a, b) => a.position - b.position);
  return mods.length > TRIAL_MODULES && mods.slice(0, TRIAL_MODULES).every(moduleDone);
}

// ============ Course complete ============

export const courseComplete = (modules: ModuleInput[], capstoneDone: boolean) => modules.length > 0 && modules.every(moduleDone) && capstoneDone;

// ============ The streak ============

/** "YYYY-MM-DD" in a time zone. */
export function localDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * The current streak (a run of days with finished work ending today or yesterday; a missed full day resets it to 0) and
 * the longest run, from the learner's local days.
 */
export function streaks(days: string[], today: string): { current: number; longest: number } {
  const nums = [...new Set(days.map(dayNumber))].sort((a, b) => a - b);
  let longest = 0, run = 0, prev = Number.NaN;
  const runs: { end: number; len: number }[] = [];
  for (const d of nums) {
    run = d === prev + 1 ? run + 1 : 1;
    prev = d;
    if (runs.length && runs[runs.length - 1].end === d - 1 && run > 1) runs[runs.length - 1] = { end: d, len: run };
    else runs.push({ end: d, len: run });
    longest = Math.max(longest, run);
  }
  const t = dayNumber(today);
  const last = runs[runs.length - 1];
  return { current: last && last.end >= t - 1 ? last.len : 0, longest };
}

// ============ Notebook ============

/** Where an item's note goes in the Notebook. */
export function notebookCategory(kind: "video" | "activity", part: string | null, itemType: string | null): "videos" | "assignments" | "tasks" | "quizzes" | "key_terms" {
  if (kind === "video") return "videos";
  if (itemType === "flashcard") return "key_terms";
  if (part === "quiz") return "quizzes";
  if (part === "assignment") return "assignments";
  return "tasks";
}
