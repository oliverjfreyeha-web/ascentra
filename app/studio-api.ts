/**
 * C1: how the pages read the course studio, the Owner's review checklist, the boosters list and the video slots. Each
 * reader takes a response body exactly as the route sends it and returns the typed value, or null when the shape isn't
 * the one expected (the page then says it couldn't load). tests/unit/studio-readers.test.ts feeds them the shapes the
 * real routes return (from tests/integration/course-structure.test.ts).
 */
import type { LessonBody } from "./courses-api";
import { RECIPE_CAPS, SANDBOX_LABEL } from "@/lib/courses/structure";

// One config file holds the caps and the video limit (lib/courses/structure.ts); the pages read them from there.
export { MIN_TRANSCRIPT_CHARS, RECIPE_CAPS, VIDEO_MAX_BYTES, tooLarge } from "@/lib/courses/structure";

export type Recipe = { videos: number; quizzes: number; assignments: number; sandboxes: number; sequences: number; boosters: string[] };
export type Finding = { where: string; text: string; claim: string; excerpt: string };
export type Brief = { purpose?: string; points?: { text: string; sources?: { sourceId?: string; title?: string }[] }[]; targetMinutes?: number | null; tone?: string; onScreen?: string[]; avoid?: string[] };
export type SlotView = {
  id: string; position: number; title: string; lessonId: string | null; status: "waiting" | "uploaded" | "approved"; brief: Brief; briefText: string; briefBy: string;
  briefEditedAt: string | null; transcript: string; approvedAt: string | null;
  file: { name: string | null; size: number; mime: string; uploadedAt: string } | null;
  history: { id: string; name: string | null; size: number; status: string; reason: string | null; uploadedAt: string; replacedAt: string | null }[];
};
export type StudioModule = {
  id: string; position: number; title: string; stage: string | null; recipe: Partial<Recipe>; recommendedPace: string;
  state: {
    coverage: { counts: Record<string, number>; missing: string[]; short: { part: string; have: number; want: number }[]; boostersMissing: string[]; types: number; varietyOk: boolean };
    findings: Finding[]; blockers: string[]; ready: boolean;
    review: { decision: "approved" | "sent_back"; note: string | null; decidedAt: string; current: boolean } | null;
  };
  lessons: {
    id: string; position: number; title: string; minutes: number | null;
    open: { id: string; version: number; status: string; verified: boolean; returnedNote: string | null } | null;
    published: { id: string; version: number } | null;
    text: { versionId: string; version: number; status: string; body: LessonBody } | null;
  }[];
  items: { id: string; lessonId: string; type: string; part: string; partSet: boolean; booster: string | null; status: string; prompt: string }[];
  slots: SlotView[];
};
export type Booster = { key: string; name: string; description: string; itemTypes: string[] };
export type Studio = {
  course: { id: string; slug: string; name: string };
  version: { id: string; version: number; status: string; ownerReviewRequired: boolean; isDraft: boolean; publishedAt: string | null; unpublishedAt: string | null } | null;
  live: { id: string; version: number; unpublishedAt: string | null } | null;
  modules: StudioModule[]; findings: Finding[]; emptySlots: number; boosters: Booster[]; canPublish: boolean; publishBlockers: string[];
};
export type Checklist = {
  courses: {
    slug: string; name: string; version: number; status: string; unpublished: boolean; approved: number; modules: number;
    waiting: { id: string; position: number; title: string }[];
    notReady: { id: string; position: number; title: string; blockers: string[] }[];
    sentBack: { id: string; position: number; title: string; note: string | null; at: string }[];
    emptySlots: { id: string; title: string; status: string; module: number }[];
    income: { ok: boolean; findings: Finding[] };
  }[];
};
export type BoosterList = { boosters: (Booster & { id: string; active: boolean; inUse: number })[]; types: { type: string; label: string }[] };
export type LessonVideo = { id: string; title: string; state: "ready" | "coming"; transcript: string | null };
export type VideoLink = { id: string; title: string; url: string; mime: string; expiresIn: number; transcript: string };

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";

export const isSlot = (s: unknown): s is SlotView => obj(s) && str(s.id) && str(s.title) && str(s.status) && str(s.briefText) && arr(s.history);

export function studioFrom(body: unknown): Studio | null {
  if (!obj(body) || !obj(body.course) || !arr(body.modules) || !arr(body.findings) || !arr(body.publishBlockers) || typeof body.emptySlots !== "number") return null;
  const ok = body.modules.every((m) => obj(m) && str(m.id) && obj(m.state) && arr(m.lessons) && arr(m.items) && arr(m.slots) && m.slots.every(isSlot));
  return ok ? (body as unknown as Studio) : null;
}
export function checklistFrom(body: unknown): Checklist | null {
  if (!obj(body) || !arr(body.courses)) return null;
  return body.courses.every((c) => obj(c) && str(c.slug) && arr(c.waiting) && arr(c.sentBack) && arr(c.emptySlots) && obj(c.income)) ? (body as unknown as Checklist) : null;
}
export function boostersFrom(body: unknown): BoosterList | null {
  return obj(body) && arr(body.boosters) && arr(body.types) && body.boosters.every((b) => obj(b) && str(b.key) && arr(b.itemTypes)) ? (body as unknown as BoosterList) : null;
}
export function slotFrom(body: unknown): SlotView | null {
  return isSlot(body) ? body : null;
}
export function uploadStartFrom(body: unknown): { uploadId: string; url: string; mime: string; maxBytes: number } | null {
  return obj(body) && str(body.uploadId) && str(body.url) && str(body.mime) && typeof body.maxBytes === "number" ? (body as { uploadId: string; url: string; mime: string; maxBytes: number }) : null;
}
export function lessonVideosFrom(body: unknown): LessonVideo[] {
  if (!obj(body) || !arr(body.videos)) return [];
  return body.videos.filter((v): v is LessonVideo => obj(v) && str(v.id) && str(v.title) && (v.state === "ready" || v.state === "coming"));
}
export function videoLinkFrom(body: unknown): VideoLink | null {
  return obj(body) && str(body.url) && str(body.mime) && typeof body.expiresIn === "number" ? (body as unknown as VideoLink) : null;
}

export const SLOT_STATUS: Record<SlotView["status"], string> = { waiting: "Waiting for video", uploaded: "Uploaded", approved: "Approved" };
export const PART_NAMES: Record<string, string> = { videos: "Videos", quizzes: "Quizzes", assignments: "Assignments", sandboxes: "Sandboxes", sequences: "Interactive sequences" };
export const BOOSTERS_MAX = RECIPE_CAPS.boosters.max;
export const ITEM_PARTS = [["quiz", "Quiz"], ["assignment", "Assignment"], ["sandbox", SANDBOX_LABEL], ["sequence", "Interactive sequence"], ["booster", "Learning booster"]] as const;
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The review line under a lesson's title: "Reviewed by the Owner" only with the Owner's recorded approval of that version. */
export function reviewLabel(review: { by: "owner"; date: string } | { by: "reviewer" } | null | undefined, locale?: string): string | null {
  if (!review) return null;
  return review.by === "owner" ? `Reviewed by the Owner on ${new Date(review.date).toLocaleDateString(locale)}` : "Reviewed by an ASCENTRA reviewer";
}

/** The studio's base path for one course (the course builder's own GET of this path is read by courseDetailFrom). */
export const courseApi = (slug: string) => `/api/v1/courses/${encodeURIComponent(slug)}` as const;
