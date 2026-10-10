import "server-only";
import { randomUUID } from "node:crypto";
import { accountById, type Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { aiConfigured, spendSoFar } from "@/lib/ai";
import { CATALOG_LESSONS_ESTIMATE, estimateUsd, spendCaps, topicEstimate, type Step } from "@/lib/ai/config";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { canSeeCourse, courseScope, refused, type Result } from "@/lib/courses/common";
import { courseFreshness } from "@/lib/courses/refresh";
import { runResearch } from "@/lib/courses/research";
import { generateBlueprint } from "@/lib/courses/blueprint";
import { draftLesson } from "@/lib/courses/lessons";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { actorOf } from "@/lib/auth/require-cap";
import { draftPool } from "@/lib/activities/draft";
import { varietyFailures } from "@/lib/activities/review";

/**
 * L6: the topic catalog and batch generation.
 *   - The catalog lists every learnable topic from the Academy Blueprint (catalog_topics) and every existing course,
 *     with its state: no course, researching, waiting for source approval, drafting, in review, published, stale.
 *   - The Owner or a Course Admin (assigned topics only) queues topics after seeing the whole batch's cost estimate.
 *   - Each night (vercel.json → /api/cron/catalog) the queue advances ONE COURSE AT A TIME through the existing L2 steps:
 *     research → (a person approves sources) → Blueprint → (a person approves it) → lesson drafts and practice pools →
 *     (a person reviews and publishes). It stops whenever a person is needed and says what for. Every AI step is counted
 *     against the L1 spend caps; when the next step won't fit, the rest waits for the next night and says why. The
 *     steps run as the person who queued the topic, with their rights checked again each night. Results enter as Draft.
 */
const ACTOR = SYSTEM_ACTOR("Batch generation");
/** An AI step of the overnight run is recorded as the person who queued it, marked as the batch run. */
const batchActor = (a: Account) => { const x = actorOf(a); return { ...x, label: `${x.label} (overnight batch)` }; };
export type CatalogState = "no_course" | "researching" | "waiting_sources" | "drafting" | "in_review" | "published" | "stale";
export const STATE_LABEL: Record<CatalogState, string> = {
  no_course: "No course", researching: "Researching", waiting_sources: "Waiting for source approval", drafting: "Drafting",
  in_review: "In review", published: "Published", stale: "Stale",
};
export const WAITING_LABEL: Record<string, string> = {
  source_approval: "source approval (Sources page)", blueprint_approval: "Blueprint approval (course builder)", review: "review and publishing (course builder)",
  spend_cap: "the next night: the AI spend cap is reached", run_time: "the next night: tonight's run time was used up",
};

type Job = {
  id: string; batch_id: string; topic_slug: string; topic_name: string; audience_level: string; status: string; waiting_for: string | null; note: string | null;
  research_run_id: string | null; blueprint_id: string | null; academy_id: string | null; estimate_usd: number | string; queued_by_account_id: string;
  queued_at: string; last_step_at: string | null; finished_at: string | null; structure?: number; size_tier?: string | null;
};
type Topic = { slug: string; name: string; outcome: string | null; audience_level: string; origin: string };
type CourseInfo = { exists: boolean; published: boolean; stale: boolean; inReview: boolean; drafting: boolean };

/** The state shown for a topic. Pure: tested on its own. A live job decides while it runs; then the course does. */
export function catalogState(job: Pick<Job, "status" | "waiting_for"> | null, c: CourseInfo | null): CatalogState {
  if (job && !["done", "canceled", "failed"].includes(job.status)) {
    if (job.status === "queued" || job.status === "researching") return "researching";
    if (job.status === "waiting" && job.waiting_for === "source_approval") return "waiting_sources";
    if (job.status === "waiting") return "in_review";
    return "drafting";
  }
  if (!c?.exists) return "no_course";
  if (c.published) return c.stale ? "stale" : "published";
  if (c.inReview) return "in_review";
  return "drafting";
}

async function courseInfo(academyId: string): Promise<CourseInfo> {
  const db = getDb();
  const courses = ((await db.from("courses").select("id, version, status").eq("academy_id", academyId)).data ?? []) as { id: string; version: number; status: string }[];
  const bps = ((await db.from("academy_blueprints").select("status, kind").eq("academy_id", academyId)).data ?? []) as { status: string; kind: string }[];
  const draftBp = bps.some((b) => b.kind === "course" && b.status === "draft");
  if (!courses.length) return { exists: draftBp, published: false, stale: false, inReview: draftBp, drafting: false };
  const versions = ((await db.from("lesson_versions").select("status").in("course_id", courses.map((c) => c.id))).data ?? []) as { status: string }[];
  const published = versions.some((v) => v.status === "published");
  const f = published ? await courseFreshness(academyId) : null;
  return { exists: true, published, stale: !!f && (f.due || f.staleLessons.length > 0), inReview: draftBp || versions.some((v) => v.status === "review"), drafting: !published };
}

/** C1: where a topic's course stands, in the four words the Owner sees, plus where a learner opens it. */
export type CourseStatus = "none" | "drafting" | "in_review" | "published" | "unpublished";
export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = { none: "None", drafting: "Drafting", in_review: "In review", published: "Published", unpublished: "Unpublished" };

/** The course status of each catalog slug, and the first published lesson of a live course. */
export async function courseStatuses(slugs: string[]): Promise<Map<string, { status: CourseStatus; label: string; firstLessonId: string | null }>> {
  const out = new Map<string, { status: CourseStatus; label: string; firstLessonId: string | null }>();
  if (!slugs.length) return out;
  const db = getDb();
  const academies = ((await db.from("academies").select("id, slug").in("slug", slugs)).data ?? []) as { id: string; slug: string }[];
  const jobs = ((await db.from("catalog_jobs").select("topic_slug, status, waiting_for").in("topic_slug", slugs)).data ?? []) as Pick<Job, "topic_slug" | "status" | "waiting_for">[];
  for (const slug of slugs) {
    const a = academies.find((x) => x.slug === slug);
    const job = jobs.find((j) => j.topic_slug === slug && !["done", "canceled", "failed"].includes(j.status)) ?? null;
    let status: CourseStatus = "none";
    let firstLessonId: string | null = null;
    if (a) {
      const courses = ((await db.from("courses").select("id, version, status, unpublished_at").eq("academy_id", a.id)).data ?? []) as { id: string; version: number; status: string; unpublished_at: string | null }[];
      const live = courses.filter((c) => c.status === "published" || c.status === "restored").sort((x, y) => y.version - x.version)[0];
      if (live && !live.unpublished_at) {
        status = "published";
        const mods = ((await db.from("modules").select("id, position").eq("course_id", live.id)).data ?? []) as { id: string; position: number }[];
        const lessons = mods.length ? ((await db.from("lessons").select("id, module_id, position").in("module_id", mods.map((m) => m.id))).data ?? []) as { id: string; module_id: string; position: number }[] : [];
        const pub = new Set((((lessons.length ? (await db.from("lesson_versions").select("lesson_id").eq("status", "published").in("lesson_id", lessons.map((l) => l.id))).data : []) ?? []) as { lesson_id: string }[]).map((v) => v.lesson_id));
        const pos = (l: { module_id: string; position: number }) => (mods.find((m) => m.id === l.module_id)?.position ?? 0) * 1000 + l.position;
        firstLessonId = lessons.filter((l) => pub.has(l.id)).sort((x, y) => pos(x) - pos(y))[0]?.id ?? null;
      } else if (live?.unpublished_at) status = "unpublished";
      else {
        const info = await courseInfo(a.id);
        const st = catalogState(job, info);
        status = st === "no_course" ? "none" : st === "in_review" ? "in_review" : "drafting";
      }
    } else if (job) status = catalogState(job, null) === "in_review" ? "in_review" : "drafting";
    out.set(slug, { status, label: COURSE_STATUS_LABEL[status], firstLessonId });
  }
  return out;
}

const jobView = (j: Job) => ({
  id: j.id, status: j.status, waitingFor: j.waiting_for, waitingLabel: j.waiting_for ? WAITING_LABEL[j.waiting_for] : null, note: j.note,
  estimateUsd: Number(j.estimate_usd), queuedAt: j.queued_at, lastStepAt: j.last_step_at, finishedAt: j.finished_at,
});

/** Every topic the account may see, with its state; the Owner also sees modules that fail the variety rule. */
export async function listCatalog(actor: Account) {
  const db = getDb();
  const topics = ((await db.from("catalog_topics").select("slug, name, outcome, audience_level, origin").order("name", { ascending: true })).data ?? []) as Topic[];
  const academies = ((await db.from("academies").select("id, slug, name, outcome")).data ?? []) as { id: string; slug: string; name: string; outcome: string | null }[];
  const all: (Topic & { academyId: string | null })[] = [
    ...topics.map((t) => ({ ...t, academyId: academies.find((a) => a.slug === t.slug)?.id ?? null })),
    ...academies.filter((a) => !topics.some((t) => t.slug === a.slug)).map((a) => ({ slug: a.slug, name: a.name, outcome: a.outcome, audience_level: "beginner", origin: "course", academyId: a.id })),
  ].filter((t) => t.slug !== OWNER_ACADEMY_SLUG && (actor.roleKey === "owner" || actor.roleKey === "superAdmin" || canSeeCourse(actor, t.slug)));
  const jobs = ((await db.from("catalog_jobs").select("*").order("queued_at", { ascending: false })).data ?? []) as Job[];
  const rows = [];
  for (const t of all) {
    const job = jobs.find((j) => j.topic_slug === t.slug) ?? null;
    const info = t.academyId ? await courseInfo(t.academyId) : null;
    const state = catalogState(job, info);
    rows.push({
      slug: t.slug, name: t.name, outcome: t.outcome, audience: t.audience_level, origin: t.origin, state, stateLabel: STATE_LABEL[state],
      hasCourse: !!info?.exists, canQueue: !courseScope(actor, "courses.edit", t.slug) && (actor.roleKey === "owner" || actor.roleKey === "courseAdmin")
        && !info?.exists && !(job && !["done", "canceled", "failed"].includes(job.status)),
      job: job ? jobView(job) : null,
    });
  }
  const caps = spendCaps();
  const spent = await spendSoFar();
  return {
    topics: rows, aiOn: aiConfigured(), perTopicUsd: topicEstimate(), lessonsAssumed: CATALOG_LESSONS_ESTIMATE, caps,
    spent: { day: Math.round(spent.day * 100) / 100, month: Math.round(spent.month * 100) / 100 },
    varietyFailures: actor.roleKey === "owner" ? await varietyFailures() : null,
  };
}

/**
 * Body: { slugs: string[], confirm?: true, expectedTotalUsd?, structure?: 2 }. structure 2 (C1): the course gets the
 * module recipe (5 or 6 modules), video briefs and the Owner's review. Without confirm: the whole batch's estimate, nothing
 * queued. With confirm: the same total must be confirmed, then the topics are queued for tonight.
 */
export async function queueTopics(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "catalog.queue";
  if (actor.roleKey !== "owner" && actor.roleKey !== "courseAdmin") return refused(403, "Only the Owner or a Course Admin queues topics.", A);
  const slugs = Array.isArray(body.slugs) ? [...new Set(body.slugs.filter((s): s is string => typeof s === "string"))] : [];
  if (!slugs.length || slugs.length > 20) return refused(400, "Choose 1 to 20 topics.", A);
  const list = await listCatalog(actor);
  const chosen = [];
  for (const slug of slugs) {
    const t = list.topics.find((x) => x.slug === slug);
    if (!t) return refused(404, `No such topic: ${slug}.`, A);
    const scope = courseScope(actor, "courses.edit", slug);
    if (scope) return refused(403, `${t.name}: ${scope}`, A, { type: "topic", id: slug, label: t.name });
    if (t.job && !["done", "canceled", "failed"].includes(t.job.status)) return refused(409, `${t.name} is already queued (${t.stateLabel}).`, A, { type: "topic", id: slug, label: t.name });
    if (t.hasCourse) return refused(409, `${t.name} already has a course (${t.stateLabel}). Change it in the course builder, or let a refresh check it.`, A, { type: "topic", id: slug, label: t.name });
    chosen.push(t);
  }
  const per = topicEstimate();
  const total = Math.round(per * chosen.length * 100) / 100;
  const quote = {
    topics: chosen.map((t) => ({ slug: t.slug, name: t.name, estimateUsd: per })), totalUsd: total, lessonsAssumed: CATALOG_LESSONS_ESTIMATE,
    caps: list.caps, spent: list.spent, aiOn: list.aiOn,
    note: `Runs overnight, one course at a time, inside the AI spend caps ($${list.caps.perDay}/day, $${list.caps.perMonth}/month). Each course stops when a person is needed: source approval, Blueprint approval, then review. The estimate is an upper end, for about ${CATALOG_LESSONS_ESTIMATE} lessons per course.`,
  };
  if (body.confirm !== true) return { ok: true, body: { quote }, event: { action: A, result: "Completed", context: "" } };
  if (Number(body.expectedTotalUsd) !== total) return refused(409, `The batch estimate is now $${total.toFixed(2)}. Review it and confirm again. Nothing was queued.`, A);
  const batch = randomUUID();
  const { error } = await getDb().from("catalog_jobs").insert(chosen.map((t) => ({
    batch_id: batch, topic_slug: t.slug, topic_name: t.name, audience_level: t.audience, estimate_usd: per, queued_by_account_id: actor.id, status: "queued",
    structure: body.structure === 2 ? 2 : 1,
    // C2: the size tier the Blueprint is built for (only sent with a v2 course).
    ...(body.structure === 2 && typeof body.sizeTier === "string" && ["compact", "standard", "large"].includes(body.sizeTier) ? { size_tier: body.sizeTier } : {}),
  })));
  if (error?.code === "23505") return refused(409, "One of these topics was queued at the same moment. Reload.", A);
  if (error) throw new Error(`catalog queue failed: ${error.message}`);
  return {
    ok: true, status: 201, body: { batchId: batch, queued: chosen.length, totalUsd: total },
    event: {
      action: A, result: "Completed", target: { type: "batch", id: batch, label: chosen.map((t) => t.slug).join(", ") }, previous: "not queued",
      next: `${chosen.length} topic(s) queued`,
      context: `Queued ${chosen.length} topic(s) for batch generation (${chosen.map((t) => t.name).join("; ")}), estimated at up to $${total.toFixed(2)} in all. They run overnight, one course at a time, inside the spend caps, and stop whenever a person is needed. Results enter as Draft.`,
    },
  };
}

/** Owner or Course Admin: take a topic off the queue (it keeps whatever was already drafted). */
export async function cancelJob(actor: Account, id: string): Promise<Result> {
  const A = "catalog.queue";
  const db = getDb();
  const job = (await db.from("catalog_jobs").select("*").eq("id", id).maybeSingle()).data as Job | null;
  if (!job) return refused(404, "No such queued topic.", A);
  const target = { type: "catalog_job", id, label: job.topic_name };
  if (courseScope(actor, "courses.edit", job.topic_slug)) return refused(403, "You can only work on topics assigned to you.", A, target);
  if (["done", "canceled", "failed"].includes(job.status)) return refused(409, `This job is already ${job.status}.`, A, target);
  const previous = job.status;
  const { error } = await db.from("catalog_jobs").update({ status: "canceled", waiting_for: null, note: "Canceled. Anything already drafted stays as Draft.", finished_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`catalog cancel failed: ${error.message}`);
  return { ok: true, body: { id, status: "canceled" }, event: { action: A, result: "Completed", target, previous, next: "canceled", context: `Took "${job.topic_name}" off the batch queue. Anything already drafted stays as Draft.` } };
}

// ============ The overnight run ============

async function setJob(job: Job, fields: Partial<Job>, context: string) {
  const db = getDb();
  const before = job.waiting_for ? `${job.status} (${job.waiting_for})` : job.status;
  const status = fields.status ?? job.status;
  const waiting = "waiting_for" in fields ? fields.waiting_for : job.waiting_for;
  const after = waiting ? `${status} (${waiting})` : status;
  const { error } = await db.from("catalog_jobs").update({ ...fields, last_step_at: new Date().toISOString() }).eq("id", job.id);
  if (error) throw new Error(`catalog job update failed: ${error.message}`);
  if (before !== after) {
    await recordAudit({ actor: ACTOR, action: "catalog.job.step", result: "Completed", context, target: { type: "catalog_job", id: job.id, label: job.topic_name }, previous: before, next: after, reason: "Overnight batch run" });
  }
  Object.assign(job, fields);
}

/** Room under the caps for the next step, or why not. */
async function capRoom(step: Step): Promise<string | null> {
  const caps = spendCaps();
  const spent = await spendSoFar();
  const est = estimateUsd(step);
  if (spent.day + est > caps.perDay) return `today's AI spend cap is reached ($${spent.day.toFixed(2)} of $${caps.perDay}; the next step is estimated at up to $${est.toFixed(2)}). It continues next night.`;
  if (spent.month + est > caps.perMonth) return `this month's AI spend cap is reached ($${spent.month.toFixed(2)} of $${caps.perMonth}; the next step is estimated at up to $${est.toFixed(2)}). It continues when the cap allows.`;
  return null;
}

/** A job waiting for a person: has that person acted? */
async function recheck(job: Job): Promise<void> {
  const db = getDb();
  if (job.waiting_for === "source_approval" && job.research_run_id) {
    const srcs = ((await db.from("sources").select("status").eq("research_run_id", job.research_run_id)).data ?? []) as { status: string }[];
    if (srcs.some((s) => s.status === "proposed")) return;
    if (!srcs.some((s) => s.status === "approved")) return setJob(job, { status: "failed", waiting_for: null, note: "No source from the research was approved, so there is nothing to build from. Queue it again to research again.", finished_at: new Date().toISOString() }, "No research source was approved; stopped.");
    return setJob(job, { status: "blueprinting", waiting_for: null, note: "Sources decided; the Blueprint is drafted next." }, "Sources decided; next: the Blueprint.");
  }
  if (job.waiting_for === "blueprint_approval" && job.blueprint_id) {
    const bp = (await db.from("academy_blueprints").select("status, course_id").eq("id", job.blueprint_id).maybeSingle()).data as { status: string; course_id: string | null } | null;
    if (bp?.status === "approved" && bp.course_id) return setJob(job, { status: "drafting", waiting_for: null, note: "Blueprint approved; lessons and practice pools are drafted next." }, "Blueprint approved; next: lesson drafts.");
    if (bp && bp.status !== "draft") return setJob(job, { status: "failed", waiting_for: null, note: `The Blueprint was ${bp.status}. Queue the topic again for a new one.`, finished_at: new Date().toISOString() }, `The Blueprint was ${bp.status}; stopped.`);
    return;
  }
  if (job.waiting_for === "review" && job.academy_id) {
    const lessons = await courseLessons(job);
    const published = new Set((((await db.from("lesson_versions").select("lesson_id, status").in("lesson_id", lessons.length ? lessons.map((l) => l.id) : ["00000000-0000-4000-8000-000000000000"])).data ?? []) as { lesson_id: string; status: string }[])
      .filter((v) => v.status === "published").map((v) => v.lesson_id));
    if (lessons.length && lessons.every((l) => published.has(l.id))) return setJob(job, { status: "done", waiting_for: null, note: "Every lesson is reviewed and published.", finished_at: new Date().toISOString() }, "Every lesson published; done.");
  }
}

async function courseLessons(job: Job): Promise<{ id: string; title: string }[]> {
  const db = getDb();
  const bp = job.blueprint_id ? ((await db.from("academy_blueprints").select("course_id").eq("id", job.blueprint_id).maybeSingle()).data as { course_id: string | null } | null) : null;
  if (!bp?.course_id) return [];
  const mods = ((await db.from("modules").select("id, position").eq("course_id", bp.course_id).order("position", { ascending: true })).data ?? []) as { id: string; position: number }[];
  if (!mods.length) return [];
  const lessons = ((await db.from("lessons").select("id, module_id, position, title").in("module_id", mods.map((m) => m.id))).data ?? []) as { id: string; module_id: string; position: number; title: string }[];
  return lessons.sort((a, b) => mods.findIndex((m) => m.id === a.module_id) - mods.findIndex((m) => m.id === b.module_id) || a.position - b.position);
}

/** One AI step of a job. Returns false when it can't go on tonight (cap, a person needed, or an error). */
async function step(job: Job, actor: Account): Promise<boolean> {
  const db = getDb();
  const held = async (why: string, kind: "spend_cap" | "run_time" = "spend_cap") => { await setJob(job, { waiting_for: kind, note: `Waiting for ${why}` }, `Held: ${why}`); return false; };
  const failed = async (why: string) => { await setJob(job, { status: "failed", waiting_for: null, note: why, finished_at: new Date().toISOString() }, `Stopped: ${why}`); return false; };
  if (job.status === "queued") {
    const room = await capRoom("research");
    if (room) return held(room);
    await setJob(job, { status: "researching", waiting_for: null, note: "Researching with web search." }, "Research started.");
    const r = await runResearch(actor, { topic: job.topic_name, audience: job.audience_level });
    if (!r.ok) {
      if (r.status === 429) { await setJob(job, { status: "queued" }, "Research waits for the spend cap."); return held(`the next night: ${r.reason}`); }
      if (r.status === 503) { await setJob(job, { status: "queued", waiting_for: null, note: "AI isn't set up (ANTHROPIC_API_KEY). It runs once AI is on." }, "AI is off; research waits."); return false; }
      return failed(`Research failed: ${r.reason}`);
    }
    await recordAudit({ actor: batchActor(actor), ...r.event, requestId: `catalog:${job.id}`, reason: "Overnight batch run" });
    const runId = String(r.body.id);
    await setJob(job, { status: "waiting", waiting_for: "source_approval", research_run_id: runId, note: `Research found ${r.body.sources} source(s) (${r.body.newSources} new, proposed). Approve or reject them on the Sources page.` }, "Research done; waiting for source approval.");
    await recheck(job);
    return (job.status as string) === "blueprinting";
  }
  if (job.status === "blueprinting") {
    const room = await capRoom("blueprint");
    if (room) return held(room);
    const approved = ((await db.from("sources").select("id").eq("research_run_id", job.research_run_id ?? "").eq("status", "approved")).data ?? []) as { id: string }[];
    const r = await generateBlueprint(actor, job.topic_slug, { title: job.topic_name, topic: job.topic_name, audience: job.audience_level, sourceIds: approved.slice(0, 12).map((s) => s.id), researchRunIds: [job.research_run_id], ...(job.structure === 2 ? { structure: 2, ...(job.size_tier ? { sizeTier: job.size_tier } : {}) } : {}) });
    await recordAudit({ actor: batchActor(actor), ...r.event, requestId: `catalog:${job.id}`, reason: "Overnight batch run" });
    if (!r.ok) return r.status === 429 ? held(`the next night: ${r.reason}`) : failed(`The Blueprint couldn't be drafted: ${r.reason}`);
    const academy = (await db.from("academies").select("id").eq("slug", job.topic_slug).maybeSingle()).data as { id: string } | null;
    await setJob(job, { status: "waiting", waiting_for: "blueprint_approval", blueprint_id: String(r.body.id), academy_id: academy?.id ?? null, note: "The Blueprint is a Draft. Review, edit if needed, and approve it in the course builder." }, "Blueprint drafted; waiting for approval.");
    return false;
  }
  if (job.status === "drafting") {
    const lessons = await courseLessons(job);
    for (const l of lessons) {
      const hasVersion = (((await db.from("lesson_versions").select("id").eq("lesson_id", l.id).limit(1)).data ?? []) as unknown[]).length > 0;
      const hasItems = (((await db.from("activity_items").select("id").eq("lesson_id", l.id).limit(1)).data ?? []) as unknown[]).length > 0;
      if (hasVersion && hasItems) continue;
      const room = await capRoom(hasVersion ? "activityPool" : "lesson");
      if (room) return held(room);
      const r = hasVersion ? await draftPool(actor, job.topic_slug, l.id, `catalog:${job.id}`) : await draftLesson(actor, job.topic_slug, l.id, `catalog:${job.id}`);
      await recordAudit({ actor: batchActor(actor), ...r.event, requestId: `catalog:${job.id}`, reason: "Overnight batch run" });
      if (!r.ok) return r.status === 429 ? held(`the next night: ${r.reason}`) : failed(`"${l.title}" couldn't be drafted: ${r.reason}`);
      await setJob(job, { waiting_for: null, note: `Drafted ${hasVersion ? "the practice pool" : "the lesson"} for "${l.title}".` }, "Drafting.");
      return true;
    }
    await setJob(job, { status: "waiting", waiting_for: "review", note: "Every lesson and practice pool is a Draft. Review and publish them in the course builder." }, "Drafts done; waiting for review.");
    return false;
  }
  return false;
}

/** The overnight run. Waiting jobs are re-checked; then the queue advances one course at a time while there is time. */
export async function runCatalogQueue(opts: { budgetMs?: number; now?: Date } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 150_000;
  const db = getDb();
  const now = opts.now ?? new Date();
  // A step cut off by the platform's time limit leaves a job "researching": put it back in the queue.
  const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
  for (const j of ((await db.from("catalog_jobs").select("*").eq("status", "researching").lt("last_step_at", cutoff)).data ?? []) as Job[]) {
    await setJob(j, { status: "queued", note: "The last run stopped before research finished; it runs again." }, "Research was cut off; queued again.");
  }
  const open = ((await db.from("catalog_jobs").select("*").in("status", ["queued", "waiting", "blueprinting", "drafting"]).order("queued_at", { ascending: true })).data ?? []) as Job[];
  for (const j of open.filter((x) => x.status === "waiting")) await recheck(j);
  const results: { topic: string; status: string; waitingFor: string | null }[] = [];
  let capHit: string | null = null;
  for (const job of open.filter((j) => ["queued", "blueprinting", "drafting"].includes(j.status))) {
    if (capHit || Date.now() - started > budget) {
      const why = capHit ?? "the next night: tonight's run time was used up";
      await setJob(job, { waiting_for: capHit ? "spend_cap" : "run_time", note: `Waiting for ${why}` }, `Held: ${why}`);
      results.push({ topic: job.topic_slug, status: job.status, waitingFor: job.waiting_for });
      continue;
    }
    if (!aiConfigured()) {
      await setJob(job, { waiting_for: null, note: "AI isn't set up (ANTHROPIC_API_KEY). It runs once AI is on." }, "AI is off.");
      results.push({ topic: job.topic_slug, status: job.status, waitingFor: null });
      continue;
    }
    const actor = await accountById(job.queued_by_account_id);
    if (!actor || (actor.roleKey !== "owner" && actor.roleKey !== "courseAdmin") || courseScope(actor, "courses.edit", job.topic_slug)) {
      await setJob(job, { status: "failed", waiting_for: null, note: "The person who queued this can no longer build this course. Queue it again.", finished_at: new Date().toISOString() }, "Queuer no longer allowed; stopped.");
      results.push({ topic: job.topic_slug, status: "failed", waitingFor: null });
      continue;
    }
    // One course at a time: this job advances until it needs a person, hits the cap, or the night's time is up.
    while (Date.now() - started <= budget && (await step(job, actor))) { /* next step */ }
    if (job.waiting_for === "spend_cap") capHit = job.note?.replace(/^Waiting for /, "") ?? "the next night: the AI spend cap is reached";
    else if (["queued", "blueprinting", "drafting"].includes(job.status) && !job.waiting_for && Date.now() - started > budget) {
      await setJob(job, { waiting_for: "run_time", note: "Waiting for the next night: tonight's run time was used up." }, "Held: run time.");
    }
    results.push({ topic: job.topic_slug, status: job.status, waitingFor: job.waiting_for });
  }
  return { open: open.length, results };
}
