/**
 * L8: pick your path. The five questions, the business matching, and the plan rules, as pure functions.
 *
 * The plan rules are enforced by the database (db/migrations/0019_topics_and_picks.sql: pick_topic, pause_pick,
 * reconcile_picks, owner_set_business), inside one transaction per learner. applyPick and reconcile below are the same
 * rules in TypeScript: the in-memory test database uses them, and tests/unit/picks.test.ts checks each rule. Keep the
 * two in step.
 */

export const SKILL_LIMIT_BASIC = 3;
export type PickPlan = "trial" | "basic" | "pro";
export type Kind = "business" | "skill";

/** The plan that sets the pick limits: the trial and Basic share them; Pro (and the Owner's full access) has Pro's. */
export function pickPlanOf(tier: string): PickPlan | null {
  if (tier === "trial" || tier === "basic") return tier;
  if (tier === "pro" || tier === "full") return "pro";
  return null;
}
export const skillLimitOf = (plan: PickPlan | null): number | null => (plan === "pro" ? null : SKILL_LIMIT_BASIC);

// ============ The five questions ============

export const QUESTIONS = {
  goal: {
    label: "What do you want from this?",
    options: { start: "Start a business of my own", freelance: "Offer a service to clients", skills: "Build skills for work or school", explore: "Explore and see what fits" },
  },
  hours: {
    label: "How much time can you give it each week?",
    options: { 2: "About 2 hours", 5: "About 5 hours", 10: "About 10 hours", 15: "15 hours or more" },
  },
  experience: {
    label: "How much experience do you have with business or freelancing?",
    options: { none: "None yet", some: "A little", experienced: "Quite a bit" },
  },
  style: {
    label: "Which sounds most like you?",
    options: { build: "Building things (sites, tools, systems)", sell: "Selling and talking with people", create: "Creating content (writing, video, design)" },
  },
  camera: {
    label: "How do you feel about being on camera?",
    options: { yes: "Happy to be on camera", sometimes: "Sometimes, if needed", no: "I'd rather not" },
  },
} as const;

export type PathAnswers = {
  goal: keyof typeof QUESTIONS.goal.options;
  hours: 2 | 5 | 10 | 15;
  experience: keyof typeof QUESTIONS.experience.options;
  style: keyof typeof QUESTIONS.style.options;
  camera: keyof typeof QUESTIONS.camera.options;
};

const has = <T extends object>(o: T, k: unknown): k is keyof T => (typeof k === "string" || typeof k === "number") && Object.prototype.hasOwnProperty.call(o, String(k));

/** Checks a body against the fixed lists. Returns the answers, or a plain problem to show. */
export function checkPathAnswers(body: Record<string, unknown>): { answers: PathAnswers } | { problem: string } {
  const hours = typeof body.hours === "string" ? Number(body.hours) : body.hours;
  if (!has(QUESTIONS.goal.options, body.goal)) return { problem: "Choose what you want from this." };
  if (!has(QUESTIONS.hours.options, hours)) return { problem: "Choose how much time you have each week." };
  if (!has(QUESTIONS.experience.options, body.experience)) return { problem: "Choose your experience." };
  if (!has(QUESTIONS.style.options, body.style)) return { problem: "Choose building, selling or creating." };
  if (!has(QUESTIONS.camera.options, body.camera)) return { problem: "Choose how you feel about being on camera." };
  return { answers: { goal: body.goal, hours: hours as PathAnswers["hours"], experience: body.experience, style: body.style, camera: body.camera } };
}

// ============ Matching businesses to the answers ============

/** What each seeded business mostly involves. A topic added later without traits is ranked by its order alone. */
type Traits = { style: PathAnswers["style"][]; camera: "needed" | "helps" | "none"; hours: number; level: "none" | "some" };
export const BUSINESS_TRAITS: Record<string, Traits> = {
  "ai-automation-agency": { style: ["build", "sell"], camera: "none", hours: 5, level: "some" },
  "website-design": { style: ["build"], camera: "none", hours: 5, level: "none" },
  "social-media-marketing-agency": { style: ["create", "sell"], camera: "helps", hours: 5, level: "none" },
  "seo-services": { style: ["build", "create"], camera: "none", hours: 5, level: "some" },
  "ai-content-copywriting": { style: ["create"], camera: "none", hours: 2, level: "none" },
  "video-editing": { style: ["create"], camera: "none", hours: 5, level: "none" },
  "graphic-design": { style: ["create"], camera: "none", hours: 2, level: "none" },
  "ugc-content": { style: ["create"], camera: "needed", hours: 2, level: "none" },
  "virtual-assistant": { style: ["sell", "build"], camera: "none", hours: 5, level: "none" },
  "lead-generation": { style: ["sell"], camera: "none", hours: 5, level: "some" },
  "online-tutoring": { style: ["sell", "create"], camera: "helps", hours: 2, level: "none" },
  "online-coaching": { style: ["sell"], camera: "needed", hours: 5, level: "some" },
  "no-code-apps": { style: ["build"], camera: "none", hours: 5, level: "some" },
  "podcast-editing-voiceover": { style: ["create"], camera: "none", hours: 2, level: "none" },
  "shopify-store": { style: ["build", "sell"], camera: "none", hours: 10, level: "some" },
  "amazon-fba": { style: ["sell"], camera: "none", hours: 10, level: "some" },
  "dropshipping": { style: ["sell", "build"], camera: "none", hours: 10, level: "some" },
  "print-on-demand": { style: ["create", "build"], camera: "none", hours: 5, level: "none" },
  "digital-products": { style: ["create", "build"], camera: "none", hours: 5, level: "none" },
  "online-reselling": { style: ["sell"], camera: "none", hours: 5, level: "none" },
  "youtube-channel": { style: ["create"], camera: "needed", hours: 10, level: "none" },
  "faceless-content": { style: ["create"], camera: "none", hours: 5, level: "none" },
  "newsletter": { style: ["create"], camera: "none", hours: 2, level: "none" },
  "affiliate-marketing": { style: ["create", "sell"], camera: "helps", hours: 5, level: "some" },
};

/** A fit score for one business (higher is better), and the plain reasons. */
export function scoreBusiness(slug: string, a: PathAnswers): { score: number; reasons: string[] } {
  const t = BUSINESS_TRAITS[slug];
  if (!t) return { score: 0, reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  const i = t.style.indexOf(a.style);
  if (i === 0) { score += 6; reasons.push(`Mostly ${a.style === "build" ? "building" : a.style === "sell" ? "selling" : "creating"}.`); }
  else if (i > 0) score += 3;
  if (t.camera === "needed") score += a.camera === "yes" ? 2 : a.camera === "sometimes" ? -1 : -6;
  else if (t.camera === "helps") score += a.camera === "no" ? -1 : 1;
  else if (a.camera === "no") { score += 2; reasons.push("No camera needed."); }
  if (a.hours >= t.hours) { score += 2; if (t.hours <= 2) reasons.push("Can start in a few hours a week."); }
  else score -= Math.min(4, Math.ceil((t.hours - a.hours) / 3) + 1);
  if (t.level === "some" && a.experience === "none") score -= 1;
  if (t.level === "some" && a.experience === "experienced") score += 1;
  if (a.goal === "freelance" && t.style.includes("sell")) score += 1;
  return { score, reasons };
}

export type RankedTopic<T> = T & { best: boolean; why: string[] };
/** Businesses best first: the 5 best matches flagged; the rest keep the Owner's order. Without answers, the Owner's order. */
export function rankBusinesses<T extends { slug: string; sortOrder: number }>(topics: T[], a: PathAnswers | null, top = 5): RankedTopic<T>[] {
  const byOrder = [...topics].sort((x, y) => x.sortOrder - y.sortOrder || x.slug.localeCompare(y.slug));
  if (!a) return byOrder.map((t) => ({ ...t, best: false, why: [] }));
  const scored = byOrder.map((t, i) => ({ t, i, ...scoreBusiness(t.slug, a) }));
  const best = [...scored].sort((x, y) => y.score - x.score || x.i - y.i).slice(0, top);
  const bestSet = new Set(best.map((b) => b.t.slug));
  return [
    ...best.map((b) => ({ ...b.t, best: true, why: b.reasons })),
    ...scored.filter((s) => !bestSet.has(s.t.slug)).map((s) => ({ ...s.t, best: false, why: [] })),
  ];
}

// ============ The plan rules (mirror of the database functions) ============

export type TopicRow = { id: string; kind: Kind; slug: string; published: boolean; teen_hidden: boolean; has_course: boolean };
export type PickRow = { user_id: string; topic_id: string; kind: Kind; status: "active" | "paused"; locked: boolean; picked_at: string };
export type PickResult =
  | { result: "picked"; kind: Kind; previous: string | null; has_course: boolean }
  | { result: "already"; kind: Kind }
  | { result: "limit"; limit: number; used: number }
  | { result: "locked"; current?: string }
  | { result: "not_available" } | { result: "no_account" } | { result: "paused"; kind: Kind } | { result: "not_picked" };

export const visibleTo = (t: Pick<TopicRow, "published" | "teen_hidden">, minor: boolean) => t.published && !(t.teen_hidden && minor);

/** reconcile_picks: pauses picks the learner can no longer see; Basic and trial keep 3 skills and lock the business. */
export function reconcile(picks: PickRow[], topics: TopicRow[], plan: PickPlan, minor: boolean): number {
  let paused = 0;
  for (const p of picks) {
    const t = topics.find((x) => x.id === p.topic_id);
    if (p.status === "active" && (!t || !visibleTo(t, minor))) { p.status = "paused"; p.locked = false; paused++; }
  }
  if (plan === "pro") { for (const p of picks) p.locked = false; return paused; }
  const skills = picks.filter((p) => p.kind === "skill" && p.status === "active").sort((a, b) => b.picked_at.localeCompare(a.picked_at));
  for (const p of skills.slice(SKILL_LIMIT_BASIC)) { p.status = "paused"; paused++; }
  for (const p of picks) if (p.kind === "business" && p.status === "active") p.locked = true;
  return paused;
}

/** pick_topic, for one learner's picks (changed in place; a new pick is pushed). */
export function applyPick(picks: PickRow[], topics: TopicRow[], topicId: string, userId: string, plan: PickPlan, minor: boolean, now: string): PickResult {
  const t = topics.find((x) => x.id === topicId);
  if (!t || !visibleTo(t, minor)) return { result: "not_available" };
  reconcile(picks, topics, plan, minor);
  const existing = picks.find((p) => p.topic_id === topicId);
  if (existing?.status === "active") return { result: "already", kind: t.kind };
  let previous: string | null = null;
  if (t.kind === "skill") {
    const used = picks.filter((p) => p.kind === "skill" && p.status === "active").length;
    if (plan !== "pro" && used >= SKILL_LIMIT_BASIC) return { result: "limit", limit: SKILL_LIMIT_BASIC, used };
  } else {
    const current = picks.find((p) => p.kind === "business" && p.status === "active");
    if (current) {
      if (plan !== "pro") return { result: "locked", current: current.topic_id };
      Object.assign(current, { status: "paused", locked: false });
      previous = current.topic_id;
    }
  }
  const locked = t.kind === "business" && plan !== "pro";
  if (existing) Object.assign(existing, { status: "active", picked_at: now, locked });
  else picks.push({ user_id: userId, topic_id: topicId, kind: t.kind, status: "active", locked, picked_at: now });
  return { result: "picked", kind: t.kind, previous, has_course: t.has_course };
}

/** pause_pick. */
export function applyPause(picks: PickRow[], topics: TopicRow[], topicId: string, plan: PickPlan, minor: boolean): PickResult {
  reconcile(picks, topics, plan, minor);
  const p = picks.find((x) => x.topic_id === topicId);
  if (!p || p.status !== "active") return { result: "not_picked" };
  if (p.locked) return { result: "locked" };
  p.status = "paused";
  return { result: "paused", kind: p.kind };
}
