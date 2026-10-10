/**
 * C2: how the pages read the progress, Notebook, leaderboard, community, capstone and mission APIs. Each reader takes a
 * response body exactly as the route sends it and returns the typed value, or null when the shape isn't the one
 * expected (the page then says it couldn't load). tests/integration/progress-paths.test.ts and the component tests feed
 * real answers through every reader.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const strOrNull = (v: unknown) => v === null || str(v);

export type ModuleState = "open" | "half" | "locked";
export type ProgressModule = { position: number; title: string; state: ModuleState; reason: string | null; gated: boolean; done: boolean; doneCount: number; itemCount: number };
export type ProgressCourse = {
  courseId: string; slug: string; name: string; kind: string | null; pickStatus: string | null; tier: string | null; plan: string; percent: number; done: number; items: number;
  complete: boolean; bonus: boolean; capstone: { id: string; title: string; done: boolean } | null; points: number;
  skillRank: { index: number; name: string } | null; modules: ProgressModule[];
};
export type MyProgress = {
  rank: { index: number; name: string; points: number; next: { name: string; needs: number } | null };
  streak: { current: number; longest: number }; plan: string;
  courses: ProgressCourse[]; pastCourses: string[];
  skills: { slug: string; name: string; percent: number; rank: { index: number; name: string } | null }[];
  scores: { day: string; average: number; attempts: number }[];
  pointsByDay: { day: string; points: number }[];
  timeZone: string; note: string;
  pointsFor: { shouldKnow: number; important: number; veryImportant: number };
};
const moduleOk = (m: unknown) => obj(m) && num(m.position) && str(m.title) && (m.state === "open" || m.state === "half" || m.state === "locked") && strOrNull(m.reason)
  && bool(m.gated) && bool(m.done) && num(m.doneCount) && num(m.itemCount);
export function progressFrom(body: unknown): MyProgress | null {
  if (!obj(body) || !obj(body.rank) || !num(body.rank.points) || !str(body.rank.name) || !obj(body.streak) || !num(body.streak.current) || !num(body.streak.longest)) return null;
  if (!arr(body.courses) || !arr(body.skills) || !arr(body.scores) || !arr(body.pointsByDay) || !arr(body.pastCourses) || !str(body.note) || !str(body.timeZone)) return null;
  if (!body.courses.every((c) => obj(c) && str(c.courseId) && str(c.slug) && str(c.name) && num(c.percent) && bool(c.complete) && bool(c.bonus) && arr(c.modules) && c.modules.every(moduleOk))) return null;
  return body as unknown as MyProgress;
}

// ============ Lesson extras (the lesson route's progress2) ============

export type LessonItem = {
  kind: "video" | "activity"; id: string; importance: string | null; importanceLabel: string | null; done: boolean; open: boolean; missionType: string | null;
  mission?: { label: string; contacts: boolean } | null;
};
export type LessonProgress = {
  module: { position: number; title: string; state: ModuleState; reason: string | null; doneCount: number; itemCount: number };
  items: LessonItem[]; notices: { kind: "license" | "software"; text: string }[]; rank: { name: string; index: number };
  teen?: boolean; missionLimits?: string[];
};
export function lessonProgressFrom(v: unknown): LessonProgress | null {
  if (!obj(v) || !obj(v.module) || !arr(v.items) || !arr(v.notices) || !obj(v.rank)) return null;
  if (!v.items.every((i) => obj(i) && str(i.id) && (i.kind === "video" || i.kind === "activity") && bool(i.done) && bool(i.open))) return null;
  return v as unknown as LessonProgress;
}

// ============ Notebook ============

export type NotebookEntry = { id: string; title: string; note: string; importance: string; importanceLabel: string; course: string; at: string };
export type Notebook = {
  categories: { key: string; label: string; entries: NotebookEntry[] }[];
  ideas: { id: string; body: string; at: string; updatedAt: string }[];
  ai: { on: boolean; available: boolean; dailyLimit: number }; note: string;
};
export function notebookFrom(body: unknown): Notebook | null {
  return obj(body) && arr(body.categories) && arr(body.ideas) && obj(body.ai) && bool(body.ai.on) && bool(body.ai.available) && num(body.ai.dailyLimit) && str(body.note)
    && body.categories.every((c) => obj(c) && str(c.key) && str(c.label) && arr(c.entries) && c.entries.every((e) => obj(e) && str(e.id) && str(e.note) && str(e.title)))
    && body.ideas.every((i) => obj(i) && str(i.id) && str(i.body))
    ? (body as unknown as Notebook) : null;
}
export function summaryFrom(body: unknown): { summary: string; label: string } | null {
  return obj(body) && str(body.summary) && str(body.label) ? { summary: body.summary, label: body.label } : null;
}

/** The Notebook as plain text, for "Copy as text". */
export function notebookText(n: Notebook): string {
  const out: string[] = ["My ASCENTRA Notebook", ""];
  for (const c of n.categories) {
    if (!c.entries.length) continue;
    out.push(`== ${c.label} ==`);
    for (const e of c.entries) out.push(`- ${e.title} (${e.course}, ${e.importanceLabel}): ${e.note}`);
    out.push("");
  }
  if (n.ideas.length) {
    out.push("== My ideas ==");
    for (const i of n.ideas) out.push(`- ${i.body}`);
  }
  return out.join("\n").trim();
}

// ============ Leaderboard ============

export type BoardRow = { nickname: string; rank: string; rankIndex: number; points: number; streak: number; you?: boolean; simulated?: boolean; label?: string };
export type Leaderboard =
  | { kind: "public"; rows: BoardRow[]; you: BoardRow; note: string; settings: { nickname: string | null; removed: boolean; optOut: boolean; shown: boolean } }
  | { kind: "practice"; rows: BoardRow[]; note: string; settings: null };
const rowOk = (r: unknown) => obj(r) && str(r.nickname) && str(r.rank) && num(r.points) && num(r.streak);
export function leaderboardFrom(body: unknown): Leaderboard | null {
  if (!obj(body) || !arr(body.rows) || !str(body.note) || !body.rows.every(rowOk)) return null;
  if (body.kind === "practice") return body.settings === null ? (body as unknown as Leaderboard) : null;
  if (body.kind !== "public" || !obj(body.settings) || !bool(body.settings.optOut) || !bool(body.settings.shown) || !rowOk(body.you)) return null;
  return body as unknown as Leaderboard;
}

// ============ Community ============

export type Community = {
  links: { label: string; url: string }[]; hidden: boolean; note: string;
  settings?: { discordUrl: string | null; socialLinks: { label: string; url: string }[]; hideFromTeens: boolean };
};
export function communityFrom(body: unknown): Community | null {
  return obj(body) && arr(body.links) && bool(body.hidden) && str(body.note) && body.links.every((l) => obj(l) && str(l.label) && str(l.url))
    && (body.settings === undefined || (obj(body.settings) && bool(body.settings.hideFromTeens) && arr(body.settings.socialLinks)))
    ? (body as unknown as Community) : null;
}

// ============ Capstone (learner) ============

export type CapstoneCheck = { key: string; text: string; checked: boolean };
export type LearnerCapstone = {
  id: string; title: string; brief: string; deliverables: CapstoneCheck[]; checklist: CapstoneCheck[];
  automation: { what: string; prompts: string[]; plans: { name: string; price: string; sourceUrl: string; checkedOn: string }[]; paidPlanNote: string | null } | null;
  completedAt: string | null; courseComplete: boolean; modulesDone: boolean;
};
const checkOk = (c: unknown) => obj(c) && str(c.key) && str(c.text) && bool(c.checked);
export function capstoneFrom(body: unknown): LearnerCapstone | null {
  return obj(body) && str(body.id) && str(body.title) && arr(body.deliverables) && arr(body.checklist) && body.deliverables.every(checkOk) && body.checklist.every(checkOk)
    && strOrNull(body.completedAt) && bool(body.courseComplete) && bool(body.modulesDone)
    ? (body as unknown as LearnerCapstone) : null;
}

// ============ Missions ============

export type GuardianMissions = {
  requests: { id: string; teen: string; course: string; scope: "course" | "contact"; requestedAt: string; mission: { prompt: string; kind: string } | null }[];
  limits: string[];
};
export function guardianMissionsFrom(body: unknown): GuardianMissions | null {
  return obj(body) && arr(body.requests) && arr(body.limits) && body.requests.every((r) => obj(r) && str(r.id) && str(r.teen) && str(r.course) && (r.scope === "course" || r.scope === "contact"))
    ? (body as unknown as GuardianMissions) : null;
}
export type AllowList = {
  types: { key: string; label: string; contacts: boolean; allowedStates: string[] }[];
  states: { code: string; name: string }[]; limits: string[]; note: string;
};
export function allowListFrom(body: unknown): AllowList | null {
  return obj(body) && arr(body.types) && arr(body.states) && arr(body.limits) && str(body.note)
    && body.types.every((t) => obj(t) && str(t.key) && str(t.label) && bool(t.contacts) && arr(t.allowedStates))
    ? (body as unknown as AllowList) : null;
}
