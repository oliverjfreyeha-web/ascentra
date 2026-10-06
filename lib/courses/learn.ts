import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { isUuid, refused, type Result } from "./common";
import type { Citation, LessonBody } from "./lessons";

/**
 * L2: what learners see. Only PUBLISHED lesson versions, of live course versions, ever: a Draft or a version in Review
 * is never returned here, to anyone (teens included), whatever their role. Progress records the version studied.
 * L3: when a lesson a learner studied has a newer published version, they keep seeing the version they studied, with
 * an "updated" notice and its summary, and can switch to the new one; their progress carries over.
 */
type Version = { id: string; lesson_id: string; version: number; title: string; body: LessonBody; citations: Citation[]; uncited_count: number; last_verified_on: string | null; published_at: string; change_summary: string | null };

export async function learnerCourses(actor: Account) {
  const db = getDb();
  const published = ((await db.from("lesson_versions").select("id, lesson_id, course_id, version, title, last_verified_on").eq("status", "published")).data ?? []) as
    { id: string; lesson_id: string; course_id: string; version: number; title: string; last_verified_on: string | null }[];
  if (!published.length) return [];
  const courseIds = [...new Set(published.map((v) => v.course_id))];
  const courses = ((await db.from("courses").select("id, academy_id, version, status").in("id", courseIds)).data ?? []) as { id: string; academy_id: string; version: number; status: string }[];
  const live = courses.filter((c) => c.status === "published" || c.status === "restored");
  const academies = live.length ? (((await db.from("academies").select("id, slug, name").in("id", [...new Set(live.map((c) => c.academy_id))])).data ?? []) as { id: string; slug: string; name: string }[])
    .filter((a) => a.slug !== OWNER_ACADEMY_SLUG) : [];
  const lessonIds = published.map((v) => v.lesson_id);
  const lessons = ((await db.from("lessons").select("id, module_id, position, title, minutes").in("id", lessonIds)).data ?? []) as { id: string; module_id: string; position: number; title: string; minutes: number | null }[];
  const modules = lessons.length ? (((await db.from("modules").select("id, course_id, position, title").in("id", [...new Set(lessons.map((l) => l.module_id))])).data ?? []) as { id: string; course_id: string; position: number; title: string }[]) : [];
  const done = ((await db.from("progress_records").select("lesson_id, lesson_version_id, status").eq("account_id", actor.id)).data ?? []) as { lesson_id: string | null; lesson_version_id: string | null; status: string }[];
  return academies.map((a) => {
    // The latest live version of this course.
    const course = live.filter((c) => c.academy_id === a.id).sort((x, y) => y.version - x.version)[0];
    return {
      slug: a.slug, name: a.name, version: course.version,
      modules: modules.filter((m) => m.course_id === course.id).sort((x, y) => x.position - y.position).map((m) => ({
        title: m.title,
        lessons: lessons.filter((l) => l.module_id === m.id).sort((x, y) => x.position - y.position).map((l) => {
          const v = published.find((p) => p.lesson_id === l.id)!;
          const mine = done.filter((d) => d.lesson_id === l.id && d.lesson_version_id);
          return {
            id: l.id, title: v.title, minutes: l.minutes, lastVerifiedOn: v.last_verified_on,
            done: mine.some((d) => d.status === "complete"),
            // Studied an earlier version, not this one yet.
            updated: mine.length > 0 && !mine.some((d) => d.lesson_version_id === v.id),
          };
        }),
      })).filter((m) => m.lessons.length),
    };
  }).filter((c) => c.modules.length);
}

const VERSION_COLUMNS = "id, lesson_id, course_id, version, title, body, citations, uncited_count, last_verified_on, published_at, status, change_summary";

export async function publishedVersion(lessonId: string): Promise<{ v: Version; course: { slug: string; name: string } } | null> {
  if (!isUuid(lessonId)) return null;
  const db = getDb();
  const v = (((await db.from("lesson_versions").select(VERSION_COLUMNS)
    .eq("lesson_id", lessonId).eq("status", "published").limit(1)).data ?? []) as (Version & { course_id: string; status: string })[])[0];
  if (!v || v.status !== "published") return null;
  const course = (await db.from("courses").select("academy_id, status").eq("id", v.course_id).maybeSingle()).data as { academy_id: string; status: string } | null;
  if (!course || (course.status !== "published" && course.status !== "restored")) return null;
  const academy = (await db.from("academies").select("slug, name").eq("id", course.academy_id).maybeSingle()).data as { slug: string; name: string } | null;
  if (!academy || academy.slug === OWNER_ACADEMY_SLUG) return null;
  return { v, course: academy };
}

const view = (v: Version) => ({ id: v.id, number: v.version, publishedAt: v.published_at, lastVerifiedOn: v.last_verified_on, body: v.body, citations: v.citations, uncited: v.uncited_count });

/**
 * The lesson for this learner: the version they last studied (published, or archived since), with an "updated" notice
 * when a newer version is published; or the current one with `view: "current"`. Never a Draft or one in Review.
 */
export async function learnerLesson(actor: Account, lessonId: string, opts: { view?: string | null } = {}) {
  const found = await publishedVersion(lessonId);
  if (!found) return null;
  const { v, course } = found;
  const db = getDb();
  const records = ((await db.from("progress_records").select("lesson_version_id, status, completed_at, updated_at").eq("account_id", actor.id).eq("lesson_id", lessonId)
    .order("updated_at", { ascending: false })).data ?? []) as { lesson_version_id: string | null; status: string; completed_at: string | null; updated_at: string }[];
  const onCurrent = records.find((r) => r.lesson_version_id === v.id);
  const studied = records.find((r) => r.lesson_version_id);
  let shown: Version = v;
  let progress = onCurrent ?? null;
  let update: { versionId: string; number: number; publishedAt: string; summary: string | null } | null = null;
  if (opts.view !== "current" && studied && !onCurrent) {
    const old = (((await db.from("lesson_versions").select(VERSION_COLUMNS).eq("id", studied.lesson_version_id!).limit(1)).data ?? []) as (Version & { status: string })[])[0];
    if (old && old.lesson_id === lessonId && (old.status === "published" || old.status === "archived")) {
      shown = old;
      progress = studied;
      update = { versionId: v.id, number: v.version, publishedAt: v.published_at, summary: v.change_summary };
    }
  }
  return {
    lesson: { id: lessonId, title: shown.title, course, version: view(shown) },
    progress: progress ? { status: progress.status, completedAt: progress.completed_at } : null,
    update,
  };
}

/** Body: { versionId, status: "in_progress" | "complete" }. The version must be the one published now. */
export async function recordProgress(actor: Account, lessonId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.progress";
  const found = await publishedVersion(lessonId);
  if (!found) return refused(404, "No such lesson.", A);
  if (body.versionId !== found.v.id) return refused(409, "This lesson has a newer version. Reload it.", A);
  let status = body.status === "complete" ? "complete" : body.status === "in_progress" ? "in_progress" : null;
  if (!status) return refused(400, "Say whether the lesson is in progress or complete.", A);
  const db = getDb();
  const lesson = (await db.from("lessons").select("module_id").eq("id", lessonId).maybeSingle()).data as { module_id: string } | null;
  if (!lesson) return refused(404, "No such lesson.", A);
  // Switching to an updated version keeps the learner's progress: a lesson they completed stays complete.
  if (body.carry === true) {
    const earlier = ((await db.from("progress_records").select("status").eq("account_id", actor.id).eq("lesson_id", lessonId)).data ?? []) as { status: string }[];
    if (earlier.some((r) => r.status === "complete")) status = "complete";
  }
  const fields = { status, percent: status === "complete" ? 100 : 50, completed_at: status === "complete" ? new Date().toISOString() : null };
  const existing = (((await db.from("progress_records").select("id").eq("account_id", actor.id).eq("lesson_version_id", found.v.id).limit(1)).data ?? []) as { id: string }[])[0];
  const { error } = existing
    ? await db.from("progress_records").update(fields).eq("id", existing.id)
    : await db.from("progress_records").insert({ account_id: actor.id, module_id: lesson.module_id, lesson_id: lessonId, lesson_version_id: found.v.id, ...fields });
  if (error) throw new Error(`progress failed: ${error.message}`);
  return {
    ok: true, body: { status, versionId: found.v.id },
    event: { action: A, result: "Completed", target: { type: "lesson_version", id: found.v.id, label: `${found.v.title} v${found.v.version}` }, previous: existing ? "recorded" : "none", next: status, context: `Lesson progress: ${status} on v${found.v.version}.` },
  };
}
