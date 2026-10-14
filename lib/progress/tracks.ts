/**
 * S1: the rules for a skill track (3 Rounds of 5 sections), as pure functions. Tested in tests/unit/tracks.test.ts.
 *   Round 1 section 1 is open. Within a Round, section N+1 half-opens (its first half of items) when half of section N is
 *   done and fully opens when section N is done (the C2 half-open rule). Round r+1 opens when every item of Round r is
 *   done. The plan decides which Rounds are included (lib/progress/config.ts): a Round the plan doesn't include is locked
 *   with a label naming the plans that include it; the trial includes the first half of Round 1's items, in order.
 *   No rank gates, no size tier, no capstone, no trial bonus. Progress is never lost: done items stay done.
 */
import { ROUNDS_BY_PLAN, ROUND_MULTIPLIER, ROUND_PLANS, SECTIONS_PER_ROUND, TRACK_ROUNDS, type Importance } from "./config";
import { moduleDone, pointsFor, type ModuleInput, type ModuleState, type PlanKind } from "./rules";

export type SectionInput = ModuleInput & { round: number };
export type SectionUnlock = { position: number; round: number; state: ModuleState; openItems: number; reason: string | null };
export type RoundState = { round: number; state: "open" | "locked"; reason: string | null; complete: boolean; itemCount: number; doneCount: number };

const half = (n: number) => Math.ceil(n / 2);
const doneCount = (m: ModuleInput) => m.done.filter(Boolean).length;

/** The truthful label for a Round the plan doesn't include. */
export const roundLockLabel = (round: number) => `Round ${round} is part of ${ROUND_PLANS[round] ?? "Pro"}.`;
/**
 * An item's points in a Round: base points × the Round's multiplier, rounded to the nearest whole number with halves
 * rounding up (points are stored as whole numbers), and never below the item's base points.
 */
export const trackPoints = (importance: Importance | null, round: number) => {
  const base = pointsFor(importance);
  return Math.max(base, Math.floor(base * (ROUND_MULTIPLIER[round] ?? 1) + 0.5));
};
/** Round r's sections sit at positions 5(r-1)+1 to 5r. */
export const sectionPosition = (round: number, section: number) => (round - 1) * SECTIONS_PER_ROUND + section;
export const sectionNumber = (position: number) => ((position - 1) % SECTIONS_PER_ROUND) + 1;

export function trackRounds(sections: SectionInput[]): RoundState[] {
  const out: RoundState[] = [];
  for (let r = 1; r <= TRACK_ROUNDS; r++) {
    const list = sections.filter((s) => s.round === r);
    if (!list.length) continue;
    const itemCount = list.reduce((n, s) => n + s.items, 0);
    const done = list.reduce((n, s) => n + doneCount(s), 0);
    out.push({ round: r, state: "locked", reason: null, complete: itemCount > 0 && done >= itemCount, itemCount, doneCount: done });
  }
  return out;
}

/** Every Round's and section's state for this learner. */
export function unlockTrack(plan: PlanKind, sections: SectionInput[]): { rounds: RoundState[]; sections: SectionUnlock[] } {
  const sorted = [...sections].sort((a, b) => a.position - b.position);
  const rounds = trackRounds(sorted);
  const allowed = ROUNDS_BY_PLAN[plan];
  const out: SectionUnlock[] = [];
  for (const rs of rounds) {
    const r = rs.round;
    const prev = rounds.find((x) => x.round === r - 1);
    let reason: string | null = null;
    if (plan === "none") reason = "Choose a plan to keep learning.";
    else if (plan === "full") reason = null;
    else if (r > allowed) reason = roundLockLabel(r);
    else if (r > 1 && !prev?.complete) reason = `Opens when you finish every item of Round ${r - 1}.`;
    rs.state = reason ? "locked" : "open";
    rs.reason = reason;
    const list = sorted.filter((s) => s.round === r);
    // The trial: the first half of Round 1's items, in order.
    const cap = plan === "trial" && r === 1 ? half(rs.itemCount) : Number.POSITIVE_INFINITY;
    let before = 0;
    list.forEach((s, i) => {
      const make = (state: ModuleState, why: string | null, open = state === "open" ? s.items : state === "half" ? half(s.items) : 0): SectionUnlock =>
        ({ position: s.position, round: r, state, openItems: open, reason: why });
      let u: SectionUnlock;
      if (reason) u = make("locked", reason);
      else if (plan === "full" || i === 0) u = make("open", null);
      else {
        const p = list[i - 1];
        if (moduleDone(p)) u = make("open", null);
        else if (doneCount(p) >= half(p.items)) u = make("half", `The rest opens when you finish section ${i}.`);
        else u = make("locked", `Opens when you finish half of section ${i}.`);
      }
      if (Number.isFinite(cap)) {
        const room = Math.max(0, Math.min(s.items, cap - before));
        if (u.openItems > room) {
          u = room === 0
            ? { ...u, state: "locked", openItems: 0, reason: "Not in the free trial. The rest of Round 1 is part of Basic and Pro." }
            : { ...u, state: "half", openItems: room, reason: "The rest of Round 1 is part of Basic and Pro." };
        }
      }
      before += s.items;
      out.push(u);
    });
  }
  return { rounds, sections: out };
}

/** A track is complete Round by Round: "Round complete", never "Course complete". */
export const roundComplete = (sections: SectionInput[], round: number) => {
  const list = sections.filter((s) => s.round === round);
  return list.length > 0 && list.every(moduleDone);
};
