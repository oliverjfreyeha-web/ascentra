/**
 * L7: the rules behind the interview and the personalized path, as pure functions (tested on their own).
 *   - The interview asks only four things, each from a fixed list: a learning goal, the current level, time per week,
 *     and topics/interests. No free text, so no personal details can be typed into it (teens get the same questions).
 *   - The path is chosen only from published courses, by rules: chosen topics first, then interests and words matched
 *     against each course's name, outcome and skills, then the level. Basic (and the trial) is one subject; Pro and
 *     the Owner can span subjects. Nothing is generated: courses and items are only picked.
 *   - Practice items for a lesson are picked from its published, reviewed pool by level, goal and interest tags, one
 *     per idea, keeping at least 3 activity types whenever the pool has them (the L6 variety rule).
 */
import { CODE_TYPES, MIN_MODULE_TYPES, TYPE_LABEL, type ItemType } from "@/lib/activities/types";

export const GOALS = { basics: "Understand the basics", apply: "Apply it in my work or projects", deeper: "Go deeper in something I know" } as const;
export type Goal = keyof typeof GOALS;
export const LEVELS = { beginner: "New to it", intermediate: "I know the basics", advanced: "I'm experienced" } as const;
export type Level = keyof typeof LEVELS;
export const MINUTES = [60, 120, 180, 300, 480] as const;
/** Interest tags offered in the interview (plus any tags on published items). Short words, never personal details. */
export const BASE_INTERESTS = ["home-services", "retail", "online-store", "agency", "freelance", "local-business", "social-media", "video", "sales-calls", "operations"] as const;
export const PATH_LIMIT = { basic: 1, pro: 5 } as const;
export const MAX_ITEMS_PER_LESSON = 6;
export const MINUTES_PER_ITEM = 3;

export type Answers = { goal: Goal; level: Level; minutesPerWeek: number; topics: string[]; interests: string[] };
export const isGoal = (v: unknown): v is Goal => typeof v === "string" && v in GOALS;
export const isLevel = (v: unknown): v is Level => typeof v === "string" && v in LEVELS;
const TAG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Validates the answers against the lists shown (null and why when not). Pure. */
export function checkAnswers(body: Record<string, unknown>, allowed: { topics: string[]; interests: string[] }): { answers: Answers } | { problem: string } {
  if (!isGoal(body.goal)) return { problem: "Choose a goal." };
  if (!isLevel(body.level)) return { problem: "Choose your current level." };
  if (!(MINUTES as readonly number[]).includes(body.minutesPerWeek as number)) return { problem: "Choose the time you have each week." };
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);
  const topics = list(body.topics);
  const interests = list(body.interests);
  if (topics.length > 10 || interests.length > 10) return { problem: "Choose at most 10 topics and 10 interests." };
  if (topics.some((t) => !TAG.test(t) || !allowed.topics.includes(t))) return { problem: "Choose topics from the list." };
  if (interests.some((t) => !TAG.test(t) || !allowed.interests.includes(t))) return { problem: "Choose interests from the list." };
  return { answers: { goal: body.goal, level: body.level, minutesPerWeek: body.minutesPerWeek as number, topics, interests } };
}

export type Candidate = { slug: string; name: string; outcome: string | null; skills: string[]; audience: string | null; tags: string[]; minutes: number; lastVerifiedOn: string | null };
export type Scored = { slug: string; score: number; reasons: string[] };

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** How well a published course fits the answers, and why, in plain words. Pure. */
export function scoreCourse(a: Answers, c: Candidate, topicNames: Record<string, string> = {}): Scored {
  const reasons: string[] = [];
  let score = 0;
  if (a.topics.includes(c.slug)) { score += 10; reasons.push(`You chose the topic "${topicNames[c.slug] ?? c.name}".`); }
  const text = new Set(words([c.name, c.outcome ?? "", ...c.skills].join(" ")));
  for (const t of a.topics.filter((t) => t !== c.slug)) {
    const hit = words(topicNames[t] ?? t).filter((w) => text.has(w));
    if (hit.length) { score += 3; reasons.push(`It covers "${hit.join(", ")}", from a topic you chose.`); }
  }
  for (const i of a.interests) {
    const hit = c.tags.includes(i) || words(i).some((w) => text.has(w));
    if (hit) { score += 2; reasons.push(`It matches your interest "${i}".`); }
  }
  if (c.audience) {
    const fits = c.audience === a.level || (a.level === "advanced" && c.audience === "intermediate");
    if (fits) { score += 2; reasons.push(`It's written for ${c.audience} learners, like you.`); }
  }
  return { slug: c.slug, score, reasons };
}

/** The path by rules: best fits first, cut to the plan's limit. Topics with no published course are the gaps. Pure. */
export function pickCourses(a: Answers, candidates: Candidate[], plan: "basic" | "pro", topicNames: Record<string, string> = {}) {
  const scored = candidates.map((c) => scoreCourse(a, c, topicNames)).sort((x, y) => y.score - x.score || x.slug.localeCompare(y.slug));
  const matched = scored.filter((s) => s.score > 0);
  const chosen = (matched.length ? matched : scored).slice(0, PATH_LIMIT[plan]).map((s) => ({
    ...s, reasons: s.reasons.length ? s.reasons : ["A published course at your level; nothing matched your topics more closely."],
  }));
  const gaps = a.topics.filter((t) => !candidates.some((c) => c.slug === t));
  return { chosen, gaps };
}

/** Weeks to finish at the learner's pace. Pure. */
export const weeksFor = (minutes: number, perWeek: number) => Math.max(1, Math.ceil(minutes / Math.max(30, perWeek)));

export type PoolItem = { id: string; item_type: ItemType; level: string; goal: string; interests: string[]; idea_key: string };
const GOAL_TYPES: Record<Goal, ItemType[]> = {
  basics: ["multiple_choice", "true_false", "flashcard", "matching", "short_answer"],
  apply: ["build_it", "mini_project", "branching_scenario", "case_teardown", "ordering"],
  deeper: ["teach_back", "spot_the_mistake", "case_teardown", "matching", "ordering"],
};

/**
 * Picks a lesson's practice items for these answers: by level, goal and interest tags, one per idea, at most
 * MAX_ITEMS_PER_LESSON, and at least 3 activity types whenever the pool has them. Each pick says why. Pure.
 */
export function selectActivities(pool: PoolItem[], a: Answers): { id: string; why: string[] }[] {
  const wantLevel = a.level === "beginner" ? "beginner" : "intermediate";
  const scored = pool.map((i) => {
    const why: string[] = [];
    let s = 0;
    if (i.level === wantLevel) { s += 3; why.push(`at your level (${wantLevel})`); }
    if (GOAL_TYPES[a.goal].includes(i.item_type)) { s += 2; why.push(`suits your goal: ${GOALS[a.goal].toLowerCase()}`); }
    const tags = i.interests.filter((t) => a.interests.includes(t));
    if (tags.length) { s += tags.length; why.push(`matches your interest${tags.length > 1 ? "s" : ""}: ${tags.join(", ")}`); }
    if ((CODE_TYPES as readonly string[]).includes(i.item_type)) s += 0.5; // a graded check counts toward progress
    return { i, s, why };
  }).sort((x, y) => y.s - x.s || x.i.id.localeCompare(y.i.id));
  // One per idea (variants of an idea are alternatives, not extra work).
  const byIdea = new Map<string, (typeof scored)[number]>();
  for (const x of scored) if (!byIdea.has(x.i.idea_key)) byIdea.set(x.i.idea_key, x);
  const best = [...byIdea.values()];
  const chosen = best.slice(0, MAX_ITEMS_PER_LESSON);
  // The variety rule: swap the weakest picks for the best items of missing types until 3 types (if the pool has them).
  const poolTypes = new Set(best.map((x) => x.i.item_type)).size;
  const need = Math.min(MIN_MODULE_TYPES, poolTypes);
  for (const x of best.slice(chosen.length)) {
    if (new Set(chosen.map((c) => c.i.item_type)).size >= need) break;
    if (chosen.some((c) => c.i.item_type === x.i.item_type)) continue;
    // Replace the lowest-scored pick whose type appears more than once.
    const counts = new Map<string, number>();
    for (const c of chosen) counts.set(c.i.item_type, (counts.get(c.i.item_type) ?? 0) + 1);
    const idx = [...chosen.keys()].reverse().find((k) => (counts.get(chosen[k].i.item_type) ?? 0) > 1);
    if (idx === undefined) break;
    chosen[idx] = { ...x, why: [...x.why, `adds a ${TYPE_LABEL[x.i.item_type].toLowerCase()}, to keep at least 3 kinds of practice`] };
  }
  return chosen.map((c) => ({ id: c.i.id, why: c.why.length ? c.why : ["keeps the practice varied"] }));
}

/** The words for the AI ranking step: the four answers only, never a name, email or id. Pure (tested). */
export function rankPrompt(a: Answers, topicNames: Record<string, string>, candidates: Candidate[]): string {
  return [
    `Goal: ${GOALS[a.goal]}`, `Level: ${LEVELS[a.level]}`, `Time per week: ${a.minutesPerWeek} minutes`,
    `Topics chosen: ${a.topics.map((t) => topicNames[t] ?? t).join(", ") || "none"}`, `Interests: ${a.interests.join(", ") || "none"}`,
    "", "Published courses:",
    ...candidates.map((c, n) => `${n + 1}. ${c.name}${c.outcome ? `: ${c.outcome}` : ""}${c.skills.length ? ` (skills: ${c.skills.slice(0, 8).join(", ")})` : ""}`),
  ].join("\n");
}
