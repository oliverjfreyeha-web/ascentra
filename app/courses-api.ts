/**
 * L2: how the pages read the course-generation API. Each reader takes a response body exactly as the route sends it
 * and returns the typed value, or null when the shape isn't the one expected (the page then says it couldn't load,
 * rather than showing nothing). tests/integration/course-generation.test.ts feeds the real routes' answers through
 * every reader, so a page can't drift from what the API actually returns (L1's /api/v1/me lesson).
 */

export type OutdatedNote = { item: string; replacedBy: string | null; note: string; sources: { url: string; title: string | null }[] };
export type ResearchRun = {
  id: string; topic: string; audience: string; freshness: string; status: string; searches: number; claims: number; costUsd: number; createdAt: string;
  outdated: OutdatedNote[]; sources: { id: string; title: string; url: string; status: string; pageAge: string | null }[];
};
export type Estimate = {
  aiOn: boolean; course: { research: number; blueprint: number; perLesson: number; lessons: number; total: number };
  caps: { perDay: number; perMonth: number }; spent: { day: number; month: number }; left: { day: number; month: number };
};
export type Freshness = {
  days: number; lastVerifiedAt: string | null; nextRefreshAt: string | null; due: boolean; status: "idle" | "queued" | "running" | "waiting_cap" | "failed";
  note: string | null; queuedAt: string | null; lastRunAt: string | null; staleLessons: string[]; estimateUsd: number;
};
export type RefreshReport = {
  id: string; trigger: string; status: "running" | "ready" | "failed" | "reviewed"; since: string | null; startedAt: string; finishedAt: string | null;
  reviewedAt: string | null; reviewNote: string | null; costUsd: number; error: string | null;
  sourceChecks: { sourceId: string; title: string; url: string | null; result: "ok" | "changed" | "gone" | "unreachable"; detail: string }[];
  newSources: { id: string; title: string; url: string | null; status: string; pageAge: string | null }[];
  marketSignal: { pace: "quick" | "moderate" | "stable" | "unclear"; notes: { text: string; sources: { url: string; title: string | null }[] }[] };
  doubtful: { lessonId: string; lessonTitle: string; versionId: string; paragraph: string; text: string; kind: string; reason: string }[];
  edits: {
    id: string; lessonId: string; lessonTitle: string; location: string; oldText: string; newText: string; reason: string;
    status: "suggested" | "approved" | "rejected"; draftVersionId: string | null; sources: { sourceId: string; title: string; url: string | null; status: string }[];
  }[];
};
export type CourseSummary = { slug: string; name: string; freshness: Freshness; versions: { id: string; version: number; status: string; publishedAt: string | null }[]; blueprints: { draft: number; approved: number } };
export type KeyClaim = { claim: string; sourceId: string | null; claimId?: string | null; quote?: string | null };
export type Plan = {
  title: string; outcome: string; structure?: 2;
  modules: {
    title: string; stage: string | null; lessons: { title: string; minutes: number | null; objectives: string[]; keyClaims: KeyClaim[] }[]; skills: { key: string; name: string }[];
    // C1: a v2 outline's module recipe and video briefs.
    recipe?: { videos: number; quizzes: number; assignments: number; sandboxes: number; sequences: number; boosters: string[] };
    videos?: { title: string; brief: { purpose?: string; points?: { text: string; sources?: { title?: string }[] }[]; targetMinutes?: number | null } }[];
  }[];
};
export type Para = { text: string; refs: number[] };
export type LessonBody = { summary: string; sections: { heading: string; paragraphs: Para[] }[]; takeaways: Para[] };
export type Citation = { ref: number; sourceId: string; title: string; url: string | null; license: string; lastChecked: string | null };
export type LessonVersion = {
  id: string; version: number; status: "draft" | "review" | "published" | "archived"; body: LessonBody; citations: Citation[]; uncited: number;
  removedForCopying: { text: string; copiedWords: number }[]; lastVerifiedOn: string | null; generatedBy: string; model: string | null; createdAt: string;
  submittedAt: string | null; verifiedAt: string | null; verified: boolean; verificationNote: string | null; returnedNote: string | null;
  publishedAt: string | null; archivedAt: string | null; changeSummary: string | null; fromRefresh: boolean; diffAgainst: number | null; diff: { op: "same" | "add" | "remove"; text: string }[];
};
export type CourseDetail = {
  course: { slug: string; name: string; outcome: string | null };
  freshness: Freshness;
  reports: RefreshReport[];
  versions: { id: string; version: number; status: string; publishedAt: string | null; createdAt: string }[];
  current: { id: string; version: number; status: string } | null;
  blueprints: {
    id: string; status: string; topic: string; audience: string; plan: Plan; outdated: OutdatedNote[]; generatedBy: string; model: string | null;
    createdAt: string; editedAt: string | null; approvedAt: string | null; courseId: string | null;
    sources: { id: string; title: string; url: string | null; status: string; license: string; lastChecked: string | null; pageAge: string | null }[];
  }[];
  modules: { id: string; position: number; title: string; stage: string | null; lessons: { id: string; title: string; minutes: number | null; objectives: string[]; keyClaims: KeyClaim[]; stale: boolean; versions: LessonVersion[] }[] }[];
};
export type LearnerCourse = { slug: string; name: string; version: number; modules: { title: string; pace?: string; lessons: { id: string; title: string; minutes: number | null; lastVerifiedOn: string | null; done: boolean; updated: boolean }[] }[] };
export type LearnerLesson = {
  lesson: { id: string; title: string; course: { slug: string; name: string }; review?: { by: "owner"; date: string } | { by: "reviewer" } | null; version: { id: string; number: number; publishedAt: string; lastVerifiedOn: string | null; body: LessonBody; citations: Citation[]; uncited: number } };
  progress: { status: string; completedAt: string | null } | null;
  /** L3: a newer published version than the one this learner studied. */
  update: { versionId: string; number: number; publishedAt: string; summary: string | null } | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isBody = (b: unknown): b is LessonBody => obj(b) && arr(b.sections) && arr(b.takeaways);
const isFreshness = (f: unknown): f is Freshness => obj(f) && num(f.days) && str(f.status) && arr(f.staleLessons) && typeof f.due === "boolean";

export type LibrarySource = { id: string; title: string; url: string | null; licenseClass: string; status: string; lastCheckedAt: string | null; foundAt: string };
/** GET /api/v1/sources (L1). */
export function librarySourcesFrom(body: unknown): LibrarySource[] | null {
  if (!obj(body) || !arr(body.sources)) return null;
  return body.sources.every((s) => obj(s) && str(s.id) && str(s.title) && str(s.status)) ? (body.sources as LibrarySource[]) : null;
}

export function researchRunsFrom(body: unknown): ResearchRun[] | null {
  if (!obj(body) || !arr(body.runs)) return null;
  return body.runs.every((r) => obj(r) && str(r.id) && str(r.topic) && arr(r.sources) && arr(r.outdated)) ? (body.runs as ResearchRun[]) : null;
}

export type ResearchResult = { id: string; sources: number; newSources: number; claims: number; uncited: number; outdated: number; searches: number; costUsd: number };
/** POST /api/v1/sources/research's answer. */
export function researchResultFrom(body: unknown): ResearchResult | null {
  return obj(body) && str(body.id) && num(body.sources) && num(body.newSources) && num(body.claims) && num(body.outdated) && num(body.costUsd)
    ? (body as unknown as ResearchResult) : null;
}

export function estimateFrom(body: unknown): Estimate | null {
  return obj(body) && typeof body.aiOn === "boolean" && obj(body.course) && num(body.course.total) && obj(body.caps) && obj(body.left) ? (body as Estimate) : null;
}

export function coursesFrom(body: unknown): CourseSummary[] | null {
  if (!obj(body) || !arr(body.courses)) return null;
  return body.courses.every((c) => obj(c) && str(c.slug) && str(c.name) && arr(c.versions) && isFreshness(c.freshness)) ? (body.courses as CourseSummary[]) : null;
}

export function courseDetailFrom(body: unknown): CourseDetail | null {
  if (!obj(body) || !obj(body.course) || !str(body.course.slug) || !arr(body.blueprints) || !arr(body.modules) || !arr(body.versions)) return null;
  if (!isFreshness(body.freshness) || !arr(body.reports) || !body.reports.every((r) => obj(r) && str(r.id) && arr(r.edits) && arr(r.sourceChecks) && obj(r.marketSignal) && arr(r.doubtful))) return null;
  const ok = body.modules.every((m) => obj(m) && arr(m.lessons) && m.lessons.every((l) => obj(l) && str(l.id) && arr(l.versions) && l.versions.every((v) => obj(v) && str(v.id) && isBody(v.body) && arr(v.citations) && arr(v.diff))))
    && body.blueprints.every((b) => obj(b) && str(b.id) && obj(b.plan) && arr(b.sources) && arr(b.outdated));
  return ok ? (body as unknown as CourseDetail) : null;
}

export function learnerCoursesFrom(body: unknown): LearnerCourse[] | null {
  if (!obj(body) || !arr(body.courses)) return null;
  return body.courses.every((c) => obj(c) && str(c.slug) && arr(c.modules)) ? (body.courses as LearnerCourse[]) : null;
}

export function learnerLessonFrom(body: unknown): LearnerLesson | null {
  if (!obj(body) || !obj(body.lesson) || !obj(body.lesson.version)) return null;
  const v = body.lesson.version;
  return str(body.lesson.id) && str(v.id) && isBody(v.body) && arr(v.citations) && "update" in body && (body.update === null || obj(body.update))
    ? (body as unknown as LearnerLesson) : null;
}

/** Roles that see each control (the server decides; this only hides buttons that would be refused). */
export const CAN = {
  build: ["owner", "superAdmin", "courseAdmin"],
  verify: ["owner", "reviewer"],
  publish: ["owner", "superAdmin", "courseAdmin"],
  research: ["owner", "superAdmin", "courseAdmin", "reviewer"],
} as const;
export const can = (what: keyof typeof CAN, role: string | null | undefined) => !!role && (CAN[what] as readonly string[]).includes(role);
export const usd = (n: number) => `$${n.toFixed(2)}`;
