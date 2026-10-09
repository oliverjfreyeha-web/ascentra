/**
 * L8: how the pages read the picks and topics APIs: each reader takes a response body exactly as the route sends it and
 * returns the typed value, or null when the shape isn't the one expected. tests/unit/picks.test.ts passes the real
 * routes' answers through every reader.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === "boolean";

export type Question = { label: string; options: Record<string, string> };
export type PathAnswers = { goal: string; hours: number; experience: string; style: string; camera: string };
export type ChoiceTopic = { slug: string; name: string; blurb: string; hasCourse: boolean; sortOrder: number; picked: boolean; paused: boolean; locked: boolean };
export type Chooser = {
  plan: "trial" | "basic" | "pro" | null;
  questions: Record<"goal" | "hours" | "experience" | "style" | "camera", Question>;
  answers: PathAnswers | null;
  businesses: (ChoiceTopic & { best: boolean; why: string[] })[];
  skills: ChoiceTopic[];
  business: { slug: string; name: string; locked: boolean; lockNote: string | null } | null;
  skillsUsed: number; skillLimit: number | null; skillCounter: string; note: string; planNote: string;
};
const topicOk = (t: unknown) => obj(t) && str(t.slug) && str(t.name) && bool(t.hasCourse) && bool(t.picked) && bool(t.locked);

export function chooserFrom(body: unknown): Chooser | null {
  if (!obj(body) || !obj(body.questions) || !arr(body.businesses) || !arr(body.skills)) return null;
  const q = body.questions;
  if (!["goal", "hours", "experience", "style", "camera"].every((k) => obj(q[k]) && str((q[k] as Obj).label) && obj((q[k] as Obj).options))) return null;
  if (!body.businesses.every((b) => topicOk(b) && bool((b as Obj).best)) || !body.skills.every(topicOk)) return null;
  if (!num(body.skillsUsed) || !(body.skillLimit === null || num(body.skillLimit)) || !str(body.skillCounter) || !str(body.note) || !str(body.planNote)) return null;
  if (!(body.answers === null || (obj(body.answers) && str(body.answers.goal) && num(body.answers.hours)))) return null;
  if (!(body.business === null || (obj(body.business) && str(body.business.slug) && bool(body.business.locked)))) return null;
  return body as unknown as Chooser;
}

export type AdminTopic = {
  id: string; kind: "business" | "skill"; slug: string; name: string; blurb: string; published: boolean; teenHidden: boolean; hasCourse: boolean;
  sortOrder: number; demand30: number; demandAll: number; activePicks: number;
};
export function adminTopicsFrom(body: unknown): { topics: AdminTopic[]; note: string } | null {
  return obj(body) && arr(body.topics) && str(body.note) && body.topics.every((t) => obj(t) && str(t.id) && str(t.slug) && (t.kind === "business" || t.kind === "skill")
    && bool(t.published) && bool(t.teenHidden) && bool(t.hasCourse) && num(t.demand30) && num(t.demandAll) && num(t.activePicks))
    ? (body as { topics: AdminTopic[]; note: string }) : null;
}

export type LearnerPicks =
  | { found: false }
  | { found: true; accountId: string; email: string; teen: boolean; plan: string | null; picks: { slug: string; name: string; kind: string; status: string; locked: boolean; pickedAt: string }[]; businesses: { slug: string; name: string }[] };
export function learnerPicksFrom(body: unknown): LearnerPicks | null {
  if (!obj(body) || !bool(body.found)) return null;
  if (!body.found) return { found: false };
  return str(body.accountId) && str(body.email) && bool(body.teen) && arr(body.picks) && arr(body.businesses)
    && body.picks.every((p) => obj(p) && str(p.name) && str(p.status) && bool(p.locked)) ? (body as LearnerPicks) : null;
}
