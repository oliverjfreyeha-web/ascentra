/**
 * L6: how the pages read the topic catalog and activity library APIs: each reader takes a response body exactly as the
 * route sends it and returns the typed value, or null when the shape isn't the one expected. tests/unit/activities.test.ts
 * and tests/integration/activities.test.ts pass the real routes' answers through every reader.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type CatalogJob = { id: string; status: string; waitingFor: string | null; waitingLabel: string | null; note: string | null; estimateUsd: number; queuedAt: string; lastStepAt: string | null; finishedAt: string | null };
export type CatalogTopic = {
  slug: string; name: string; outcome: string | null; audience: string; origin: string; state: string; stateLabel: string; hasCourse: boolean; canQueue: boolean;
  job: CatalogJob | null;
};
export type VarietyFailure = { moduleId: string; module: string; course: string; courseName: string; types: number; min: number };
export type Catalog = {
  topics: CatalogTopic[]; aiOn: boolean; perTopicUsd: number; lessonsAssumed: number; caps: { perDay: number; perMonth: number };
  spent: { day: number; month: number }; varietyFailures: VarietyFailure[] | null;
};
export type BatchQuote = { topics: { slug: string; name: string; estimateUsd: number }[]; totalUsd: number; lessonsAssumed: number; note: string; aiOn: boolean };

export function catalogFrom(body: unknown): Catalog | null {
  return obj(body) && arr(body.topics) && body.topics.every((t) => obj(t) && str(t.slug) && str(t.state) && str(t.stateLabel) && typeof t.canQueue === "boolean")
    && num(body.perTopicUsd) && obj(body.caps) && (body.varietyFailures === null || arr(body.varietyFailures)) ? (body as unknown as Catalog) : null;
}
export function batchQuoteFrom(body: unknown): BatchQuote | null {
  const q = obj(body) ? body.quote : null;
  return obj(q) && arr(q.topics) && num(q.totalUsd) && str(q.note) ? (q as unknown as BatchQuote) : null;
}
export function batchQueuedFrom(body: unknown): { batchId: string; queued: number; totalUsd: number } | null {
  return obj(body) && str(body.batchId) && num(body.queued) && num(body.totalUsd) ? (body as unknown as { batchId: string; queued: number; totalUsd: number }) : null;
}

export type LibraryItem = {
  id: string; ideaKey: string; version: number; status: string; type: string; typeLabel: string; grading: "code" | "feedback"; level: string; goal: string;
  interests: string[]; prompt: string; content: Obj; answerKey: Obj | null; explanation: string; citation: { sourceId: string; title: string; url: string | null; quote?: string };
  reviewNote: string | null; replaces: { id: string; version: number; status: string } | null; diff: { op: "same" | "add" | "remove"; text: string }[] | null;
};
export type LibraryLesson = { id: string; title: string; counts: { byType: Record<string, number>; byLevel: Record<string, number> }; items: LibraryItem[] };
export type LibraryModule = { id: string; title: string; variety: { types: number; ok: boolean; publishedTypes: number; approved: number; min: number }; lessons: LibraryLesson[] };
export type Library = { course: { slug: string; name: string }; modules: LibraryModule[] };

export function libraryFrom(body: unknown): Library | null {
  return obj(body) && obj(body.course) && arr(body.modules) && body.modules.every((m) => obj(m) && str(m.id) && obj(m.variety) && arr(m.lessons)
    && m.lessons.every((l) => obj(l) && str(l.id) && obj(l.counts) && arr(l.items))) ? (body as unknown as Library) : null;
}
export function poolDraftedFrom(body: unknown): { drafted: number; types: number; dropped: number } | null {
  return obj(body) && num(body.drafted) && num(body.types) && num(body.dropped) ? (body as unknown as { drafted: number; types: number; dropped: number }) : null;
}
export function itemStatusFrom(body: unknown): { id: string; status: string } | null {
  return obj(body) && str(body.id) && str(body.status) ? (body as { id: string; status: string }) : null;
}
export function modulePublishedFrom(body: unknown): { moduleId: string; published: number; types: number } | null {
  return obj(body) && str(body.moduleId) && num(body.published) && num(body.types) ? (body as unknown as { moduleId: string; published: number; types: number }) : null;
}
export type MissItem = { id: string; typeLabel: string; prompt: string; content: Obj; answerKey: Obj | null; attempts: number; correct: number; misses: { answer: unknown; count: number }[] };
export function missesFrom(body: unknown): MissItem[] | null {
  return obj(body) && arr(body.items) && body.items.every((i) => obj(i) && str(i.id) && num(i.attempts) && arr(i.misses)) ? (body.items as MissItem[]) : null;
}

export type LearnerActivity = {
  id: string; type: string; typeLabel: string; graded: boolean; label: string; level: string; goal: string; prompt: string; content: Obj;
  result: { attempts: number; correct?: boolean } | null;
  /** L7: why this item was picked for the learner (null in the default set). */
  why: string[] | null;
};
/** L7: whether the items shown were picked for the learner, and whether they can switch. */
export type Selection = { mode: "personal" | "default" | "all"; personalized: boolean; canPersonalize: boolean; note: string | null };
export type LessonPractice = { activities: LearnerActivity[]; selection: Selection; score: { graded: number; correct: number } };
/** GET /api/v1/learn/lessons/[id] → its practice items, how they were chosen, and the graded score (code-graded items only). */
export function lessonActivitiesFrom(body: unknown): LessonPractice | null {
  return obj(body) && arr(body.activities) && body.activities.every((a) => obj(a) && str(a.id) && typeof a.graded === "boolean" && str(a.label) && obj(a.content) && (a.why === null || arr(a.why)))
    && obj(body.selection) && str(body.selection.mode) && typeof body.selection.personalized === "boolean"
    && obj(body.score) && num(body.score.graded) && num(body.score.correct)
    ? (body as unknown as LessonPractice) : null;
}
export type Citation = { title: string; url: string | null; quote: string | null };
export type AttemptResult =
  | { graded: true; correct: boolean; correctAnswer: unknown; explanation: string; citation: Citation; score: { graded: number; correct: number } }
  | { graded: false; label: string; reveal: Obj; explanation: string; citation: Citation };
export function attemptFrom(body: unknown): AttemptResult | null {
  if (!obj(body) || typeof body.graded !== "boolean" || !str(body.explanation) || !obj(body.citation)) return null;
  if (body.graded) return typeof body.correct === "boolean" && obj(body.score) ? (body as unknown as AttemptResult) : null;
  return str(body.label) && obj(body.reveal) ? (body as unknown as AttemptResult) : null;
}
export function feedbackFrom(body: unknown): { label: string; feedback: string; note?: string | null } | null {
  return obj(body) && str(body.label) && str(body.feedback) ? (body as { label: string; feedback: string; note?: string | null }) : null;
}
