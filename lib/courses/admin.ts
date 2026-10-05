import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { aiConfigured, spendSoFar } from "@/lib/ai";
import { courseEstimate, spendCaps } from "@/lib/ai/config";
import { canSeeCourse } from "./common";
import { diffLines, lessonLines, type Citation, type LessonBody } from "./lessons";
import type { Plan } from "./blueprint";
import type { OutdatedNote } from "./research";
import { courseFreshness, refreshReports } from "./refresh";

/** L2: what the course builder shows: courses, their Blueprints, lesson versions with diffs, and cost estimates. */

type Academy = { id: string; slug: string; name: string };
type CourseRow = { id: string; academy_id: string; version: number; status: string; published_at: string | null; created_at: string };

export async function listCourses(actor: Account) {
  const db = getDb();
  const academies = (((await db.from("academies").select("id, slug, name").order("name", { ascending: true })).data ?? []) as Academy[])
    .filter((a) => canSeeCourse(actor, a.slug));
  const ids = academies.map((a) => a.id);
  const courses = ids.length ? (((await db.from("courses").select("id, academy_id, version, status, published_at, created_at").in("academy_id", ids)).data ?? []) as CourseRow[]) : [];
  const blueprints = ids.length ? (((await db.from("academy_blueprints").select("id, academy_id, status, kind, created_at").in("academy_id", ids)).data ?? []) as
    { id: string; academy_id: string; status: string; kind: string; created_at: string }[]).filter((b) => b.kind === "course") : [];
  const freshness = await Promise.all(academies.map((a) => courseFreshness(a.id)));
  return academies.map((a, i) => ({
    slug: a.slug, name: a.name, freshness: freshness[i],
    versions: courses.filter((c) => c.academy_id === a.id).sort((x, y) => x.version - y.version).map((c) => ({ id: c.id, version: c.version, status: c.status, publishedAt: c.published_at })),
    blueprints: { draft: blueprints.filter((b) => b.academy_id === a.id && b.status === "draft").length, approved: blueprints.filter((b) => b.academy_id === a.id && b.status === "approved").length },
  }));
}

export async function estimates(lessons: number) {
  const caps = spendCaps();
  const spent = await spendSoFar();
  return {
    aiOn: aiConfigured(), course: courseEstimate(lessons), caps,
    spent: { day: Math.round(spent.day * 100) / 100, month: Math.round(spent.month * 100) / 100 },
    left: { day: Math.max(0, Math.round((caps.perDay - spent.day) * 100) / 100), month: Math.max(0, Math.round((caps.perMonth - spent.month) * 100) / 100) },
  };
}

type VersionRow = {
  id: string; lesson_id: string; version: number; status: string; title: string; body: LessonBody; citations: Citation[]; uncited_count: number;
  checks: { removedForCopying?: { text: string; copiedWords: number }[] }; last_verified_on: string | null; generated_by: string; model: string | null;
  created_at: string; submitted_at: string | null; verified_at: string | null; verified_by_account_id: string | null; verification_note: string | null;
  returned_note: string | null; published_at: string | null; archived_at: string | null; change_summary: string | null; refresh_run_id: string | null;
};

export async function courseDetail(actor: Account, slug: string) {
  if (!canSeeCourse(actor, slug)) return null;
  const db = getDb();
  const academy = (await db.from("academies").select("id, slug, name, outcome").eq("slug", slug).maybeSingle()).data as (Academy & { outcome: string | null }) | null;
  if (!academy) return null;
  const courses = (((await db.from("courses").select("id, academy_id, version, status, published_at, created_at").eq("academy_id", academy.id)).data ?? []) as CourseRow[])
    .sort((a, b) => b.version - a.version);
  const bps = ((await db.from("academy_blueprints").select("*").eq("academy_id", academy.id).order("created_at", { ascending: false })).data ?? []) as {
    id: string; kind: string; status: string; topic: string; audience_level: string; plan: Plan; outdated_notes: OutdatedNote[]; source_ids: string[];
    generated_by: string; model: string | null; created_at: string; edited_at: string | null; approved_at: string | null; course_id: string | null;
  }[];
  const sourceIds = [...new Set(bps.flatMap((b) => b.source_ids ?? []))];
  const sources = sourceIds.length ? (((await db.from("sources").select("id, title, url, status, license_class, last_checked_at, page_age").in("id", sourceIds)).data ?? []) as
    { id: string; title: string; url: string | null; status: string; license_class: string; last_checked_at: string | null; page_age: string | null }[]) : [];

  const current = courses[0] ?? null;
  let modules: unknown[] = [];
  if (current) {
    const mods = ((await db.from("modules").select("id, position, title, stage").eq("course_id", current.id).order("position", { ascending: true })).data ?? []) as
      { id: string; position: number; title: string; stage: string | null }[];
    const lessons = mods.length ? (((await db.from("lessons").select("id, module_id, position, title, minutes, objectives, content").in("module_id", mods.map((m) => m.id)).order("position", { ascending: true })).data ?? []) as
      { id: string; module_id: string; position: number; title: string; minutes: number | null; objectives: string[]; content: { keyClaims?: unknown[] } }[]) : [];
    const versions = lessons.length ? (((await db.from("lesson_versions").select("*").in("lesson_id", lessons.map((l) => l.id)).order("version", { ascending: true })).data ?? []) as VersionRow[]) : [];
    modules = mods.map((m) => ({
      id: m.id, position: m.position, title: m.title, stage: m.stage,
      lessons: lessons.filter((l) => l.module_id === m.id).map((l) => {
        const vs = versions.filter((v) => v.lesson_id === l.id);
        return {
          id: l.id, title: l.title, minutes: l.minutes, objectives: l.objectives, keyClaims: l.content?.keyClaims ?? [],
          versions: vs.map((v, i) => {
            // The diff is against the version learners had (the last published or archived one), else the one before.
            const base = [...vs.slice(0, i)].reverse().find((p) => p.status === "published" || p.status === "archived") ?? vs[i - 1] ?? null;
            return {
              id: v.id, version: v.version, status: v.status, body: v.body, citations: v.citations, uncited: v.uncited_count,
              removedForCopying: v.checks?.removedForCopying ?? [], lastVerifiedOn: v.last_verified_on, generatedBy: v.generated_by, model: v.model,
              createdAt: v.created_at, submittedAt: v.submitted_at, verifiedAt: v.verified_at, verified: !!v.verified_by_account_id,
              verificationNote: v.verification_note, returnedNote: v.returned_note, publishedAt: v.published_at, archivedAt: v.archived_at,
              changeSummary: v.change_summary, fromRefresh: !!v.refresh_run_id,
              diffAgainst: base ? base.version : null,
              diff: diffLines(lessonLines(base?.body), lessonLines(v.body)),
            };
          }),
        };
      }),
    }));
  }
  const freshness = await courseFreshness(academy.id);
  const stale = new Set(freshness.staleLessons);
  for (const m of modules as { lessons: { id: string; stale?: boolean }[] }[]) for (const l of m.lessons) l.stale = stale.has(l.id);
  return {
    course: { slug: academy.slug, name: academy.name, outcome: academy.outcome },
    freshness, reports: await refreshReports(academy.id),
    versions: courses.map((c) => ({ id: c.id, version: c.version, status: c.status, publishedAt: c.published_at, createdAt: c.created_at })),
    current: current ? { id: current.id, version: current.version, status: current.status } : null,
    blueprints: bps.filter((b) => b.kind === "course").map((b) => ({
      id: b.id, status: b.status, topic: b.topic, audience: b.audience_level, plan: b.plan, outdated: b.outdated_notes ?? [], generatedBy: b.generated_by,
      model: b.model, createdAt: b.created_at, editedAt: b.edited_at, approvedAt: b.approved_at, courseId: b.course_id,
      sources: (b.source_ids ?? []).map((id) => sources.find((s) => s.id === id)).filter((s) => !!s).map((s) => ({
        id: s!.id, title: s!.title, url: s!.url, status: s!.status, license: s!.license_class, lastChecked: s!.last_checked_at, pageAge: s!.page_age,
      })),
    })),
    modules,
  };
}
