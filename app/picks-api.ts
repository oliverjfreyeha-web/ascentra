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
export type Source = { title: string; url: string };
/** C2: what a business or side-hustle card shows about starting it. Every number comes with its sources and date, or is null. */
export type CardFacts = {
  cost: { range: string; items: string[]; checkedOn: string; sources: Source[] } | null;
  outlook: { label: string; checkedOn: string; sources: Source[] } | null;
  difficulty: number | null; riskNotes: string | null; empty: string; note: string;
};
export type ChoiceTopic = {
  slug: string; name: string; blurb: string; hasCourse: boolean; courseHref?: string | null; sortOrder: number; picked: boolean; paused: boolean; locked: boolean;
  facts?: CardFacts; overlapNote?: string | null;
};
export type MainPick = { slug: string; name: string; locked: boolean; lockNote: string | null };
export type Chooser = {
  plan: "trial" | "basic" | "pro" | null;
  questions: Record<"goal" | "hours" | "experience" | "style" | "camera", Question>;
  answers: PathAnswers | null;
  businesses: (ChoiceTopic & { best: boolean; why: string[] })[];
  skills: ChoiceTopic[];
  business: MainPick | null;
  // C2: side hustles (optional; one, like the business). Older answers have neither field.
  sideHustles?: (ChoiceTopic & { best: boolean; why: string[] })[];
  sideHustle?: MainPick | null;
  skillsUsed: number; skillLimit: number | null; skillCounter: string; note: string; planNote: string;
};
const factsOk = (f: unknown) => f === undefined || (obj(f) && str(f.empty) && str(f.note) && (f.cost === null || (obj(f.cost) && str(f.cost.range) && str(f.cost.checkedOn) && arr(f.cost.sources)))
  && (f.outlook === null || (obj(f.outlook) && str(f.outlook.label) && str(f.outlook.checkedOn) && arr(f.outlook.sources))));
const topicOk = (t: unknown) => obj(t) && str(t.slug) && str(t.name) && bool(t.hasCourse) && bool(t.picked) && bool(t.locked) && factsOk(t.facts)
  && (t.overlapNote === undefined || t.overlapNote === null || str(t.overlapNote));
const mainOk = (v: unknown) => v === null || (obj(v) && str(v.slug) && bool(v.locked));

export function chooserFrom(body: unknown): Chooser | null {
  if (!obj(body) || !obj(body.questions) || !arr(body.businesses) || !arr(body.skills)) return null;
  const q = body.questions;
  if (!["goal", "hours", "experience", "style", "camera"].every((k) => obj(q[k]) && str((q[k] as Obj).label) && obj((q[k] as Obj).options))) return null;
  if (!body.businesses.every((b) => topicOk(b) && bool((b as Obj).best)) || !body.skills.every(topicOk)) return null;
  if (!(body.sideHustles === undefined || (arr(body.sideHustles) && body.sideHustles.every((b) => topicOk(b) && bool((b as Obj).best))))) return null;
  if (!(body.sideHustle === undefined || mainOk(body.sideHustle))) return null;
  if (!num(body.skillsUsed) || !(body.skillLimit === null || num(body.skillLimit)) || !str(body.skillCounter) || !str(body.note) || !str(body.planNote)) return null;
  if (!(body.answers === null || (obj(body.answers) && str(body.answers.goal) && num(body.answers.hours)))) return null;
  if (!mainOk(body.business)) return null;
  return body as unknown as Chooser;
}

export type AdminTopic = {
  id: string; kind: "business" | "side_hustle" | "skill"; slug: string; name: string; blurb: string; published: boolean; teenHidden: boolean; hasCourse: boolean;
  sortOrder: number; demand30: number; demandAll: number; activePicks: number;
  // C1: the one link to the catalog, and where its course stands.
  catalogSlug?: string | null; course?: { status: "none" | "drafting" | "in_review" | "published" | "unpublished"; label: string; firstLessonId: string | null };
  // C2: the card facts as the Owner entered them (businesses and side hustles), and what the card shows.
  facts?: AdminFacts; card?: CardFacts;
};
export type AdminFacts = {
  costLow: number | null; costHigh: number | null; costItems: string[]; costSources: Source[]; costCheckedOn: string | null;
  outlookLabel: string | null; outlookSources: Source[]; outlookCheckedOn: string | null; difficulty: number | null; riskNotes: string | null;
  teachesSkills: string[];
};
export function adminTopicsFrom(body: unknown): { topics: AdminTopic[]; note: string } | null {
  return obj(body) && arr(body.topics) && str(body.note) && body.topics.every((t) => obj(t) && str(t.id) && str(t.slug) && (t.kind === "business" || t.kind === "side_hustle" || t.kind === "skill")
    && bool(t.published) && bool(t.teenHidden) && bool(t.hasCourse) && num(t.demand30) && num(t.demandAll) && num(t.activePicks))
    ? (body as { topics: AdminTopic[]; note: string }) : null;
}

export type LearnerPicks =
  | { found: false }
  | { found: true; accountId: string; email: string; teen: boolean; plan: string | null; picks: { slug: string; name: string; kind: string; status: string; locked: boolean; pickedAt: string }[]; businesses: { slug: string; name: string }[];
    sideHustles?: { slug: string; name: string }[] };
export function learnerPicksFrom(body: unknown): LearnerPicks | null {
  if (!obj(body) || !bool(body.found)) return null;
  if (!body.found) return { found: false };
  return str(body.accountId) && str(body.email) && bool(body.teen) && arr(body.picks) && arr(body.businesses)
    && body.picks.every((p) => obj(p) && str(p.name) && str(p.status) && bool(p.locked)) ? (body as LearnerPicks) : null;
}
