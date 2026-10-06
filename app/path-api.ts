/**
 * L7: how the pages read the interview, path and course-request APIs: each reader takes a response body exactly as the
 * route sends it and returns the typed value, or null when the shape isn't the one expected. tests/unit/path.test.ts and
 * tests/integration/path.test.ts pass the real routes' answers through every reader.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type Answers = { goal: string; level: string; minutesPerWeek: number; topics: string[]; interests: string[] };
export type InterviewInfo = {
  options: { goals: { key: string; label: string }[]; levels: { key: string; label: string }[]; minutes: number[]; topics: { slug: string; name: string; hasCourse: boolean }[]; interests: string[] };
  answers: Answers | null; skipped: boolean; plan: "basic" | "pro" | null;
};
export function interviewFrom(body: unknown): InterviewInfo | null {
  const o = obj(body) ? body.options : null;
  return obj(body) && obj(o) && arr(o.goals) && arr(o.levels) && arr(o.minutes) && arr(o.topics) && arr(o.interests) && typeof body.skipped === "boolean"
    && (body.answers === null || (obj(body.answers) && str(body.answers.goal) && num(body.answers.minutesPerWeek))) ? (body as unknown as InterviewInfo) : null;
}

export type PathCourse = { slug: string; name: string; outcome: string | null; position: number; why: string; minutes: number; weeks: number; lastVerifiedOn: string | null; lessons: number; firstLessonId: string | null };
export type PathView = {
  plan: "basic" | "pro" | null; limit: number; interview: { goal: string; level: string; minutesPerWeek: number } | null; interviewNeeded: boolean; skipped: boolean;
  method: string | null; note: string | null; aiNotice: string | null; activityMode: "personal" | "default"; builtAt: string | null; courses: PathCourse[];
  canAdd: boolean; addable: { slug: string; name: string }[];
};
export function pathFrom(body: unknown): PathView | null {
  return obj(body) && arr(body.courses) && body.courses.every((c) => obj(c) && str(c.slug) && str(c.why) && num(c.minutes) && num(c.weeks)) && num(body.limit)
    && typeof body.interviewNeeded === "boolean" && str(body.activityMode) && arr(body.addable) ? (body as unknown as PathView) : null;
}
/** PUT /api/v1/learn/interview → { saved, path } (path null, with a reason, when there's no plan yet). */
export function interviewSavedFrom(body: unknown): { path: PathView | null; reason?: string } | null {
  if (!obj(body) || body.saved !== true) return null;
  if (body.path === null) return { path: null, reason: str(body.reason) ? body.reason : undefined };
  const p = pathFrom(body.path);
  return p ? { path: p } : null;
}
export function courseRequestFrom(body: unknown): { recorded: boolean; message: string; existing?: { slug: string; name: string } } | null {
  return obj(body) && typeof body.recorded === "boolean" && str(body.message) ? (body as { recorded: boolean; message: string; existing?: { slug: string; name: string } }) : null;
}
export function activityModeFrom(body: unknown): { mode: "personal" | "default" } | null {
  return obj(body) && (body.mode === "personal" || body.mode === "default") ? (body as { mode: "personal" | "default" }) : null;
}
export type CourseRequest = { id: string; topic: string; key: string; level: string; count: number; status: string; decidedAt: string | null; note: string | null; lastRequestedAt: string; firstRequestedAt: string };
export function requestsFrom(body: unknown): CourseRequest[] | null {
  return obj(body) && arr(body.requests) && body.requests.every((r) => obj(r) && str(r.id) && str(r.topic) && num(r.count) && str(r.status)) ? (body.requests as CourseRequest[]) : null;
}
export function requestDecidedFrom(body: unknown): { id: string; status: string } | null {
  return obj(body) && str(body.id) && str(body.status) ? (body as { id: string; status: string }) : null;
}
