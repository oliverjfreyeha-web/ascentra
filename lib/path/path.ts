import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { AiUnavailable, aiConfigured, structured } from "@/lib/ai";
import { estimateUsd } from "@/lib/ai/config";
import { tierOf } from "@/lib/billing";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { ATTORNEY, clean, isUuid, refused, type Result } from "@/lib/courses/common";
import { redactPersonalData, safetySignal } from "@/lib/mentor/rules";
import {
  BASE_INTERESTS, GOALS, LEVELS, MINUTES, MINUTES_PER_ITEM, PATH_LIMIT, checkAnswers, isLevel, pickCourses, rankPrompt, weeksFor,
  type Answers, type Candidate,
} from "./rules";

/**
 * L7: the interview and the personalized path.
 *   - The interview: four questions from fixed lists (goal, level, time per week, topics/interests). Private to the
 *     learner; in their Privacy Center download; deletable. Never in the audit log (only that it was answered).
 *   - The path: chosen only from published courses, by rules (lib/path/rules.ts). If AI is on and within the spend
 *     caps, Claude (Haiku 4.5) may reorder the rules' best matches, seeing only the four answers and the course list,
 *     never a name, email or id; otherwise rules alone decide, and the path says so. Basic and the trial: one subject;
 *     Pro and the Owner: up to 5 courses.
 *   - A chosen topic with no published course is a gap: an anonymous request (topic and level only) goes to the Course
 *     Admins' queue, and the learner is told plainly that no reviewed course exists yet.
 */
export const AI_PATH_NOTICE = "AI notice: Claude (an AI) ordered these published courses from your four answers only (goal, level, time and topics). It never saw your name or account. Courses and practice are only ever picked from reviewed, published content.";
const RULES_NOTE = "Matched by rules from your answers.";

type Row = { id: string; account_id: string; goal: string | null; level: string | null; minutes_per_week: number | null; topics: string[]; interests: string[]; completed_at: string | null; skipped_at: string | null };
type PathRow = { id: string; account_id: string; method: string; note: string | null; activity_mode: string; built_at: string };
type ItemRow = { id: string; path_id: string; academy_id: string; position: number; reason: string };

const planOf = async (actor: Account): Promise<"basic" | "pro" | null> => {
  const { tier } = await tierOf(actor);
  return tier === "none" ? null : tier === "pro" || tier === "full" ? "pro" : "basic";
};

/** Every published course a path can hold: a live course version with at least one published lesson (never the Owner Academy). */
export async function publishedCourses(): Promise<(Candidate & { academyId: string; firstLessonId: string | null; lessons: number })[]> {
  const db = getDb();
  const versions = ((await db.from("lesson_versions").select("lesson_id, course_id, last_verified_on").eq("status", "published")).data ?? []) as
    { lesson_id: string; course_id: string; last_verified_on: string | null }[];
  if (!versions.length) return [];
  const courses = (((await db.from("courses").select("id, academy_id, version, status").in("id", [...new Set(versions.map((v) => v.course_id))])).data ?? []) as
    { id: string; academy_id: string; version: number; status: string }[]).filter((c) => c.status === "published" || c.status === "restored");
  const academies = courses.length ? (((await db.from("academies").select("id, slug, name, outcome").in("id", [...new Set(courses.map((c) => c.academy_id))])).data ?? []) as
    { id: string; slug: string; name: string; outcome: string | null }[]).filter((a) => a.slug !== OWNER_ACADEMY_SLUG) : [];
  const lessons = ((await db.from("lessons").select("id, module_id, position, minutes").in("id", versions.map((v) => v.lesson_id))).data ?? []) as
    { id: string; module_id: string; position: number; minutes: number | null }[];
  const modules = lessons.length ? (((await db.from("modules").select("id, course_id, position").in("id", [...new Set(lessons.map((l) => l.module_id))])).data ?? []) as
    { id: string; course_id: string; position: number }[]) : [];
  const ids = courses.map((c) => c.id);
  const skills = ids.length ? (((await db.from("skills").select("course_id, name").in("course_id", ids)).data ?? []) as { course_id: string; name: string }[]) : [];
  const bps = ids.length ? (((await db.from("academy_blueprints").select("course_id, audience_level, status").in("course_id", ids)).data ?? []) as { course_id: string; audience_level: string | null; status: string }[]) : [];
  const items = ids.length ? (((await db.from("activity_items").select("course_id, interests").in("course_id", ids).eq("status", "published")).data ?? []) as { course_id: string; interests: string[] }[]) : [];
  return academies.map((a) => {
    const course = courses.filter((c) => c.academy_id === a.id).sort((x, y) => y.version - x.version)[0];
    const vs = versions.filter((v) => v.course_id === course.id);
    const ls = lessons.filter((l) => vs.some((v) => v.lesson_id === l.id))
      .sort((x, y) => (modules.find((m) => m.id === x.module_id)?.position ?? 0) - (modules.find((m) => m.id === y.module_id)?.position ?? 0) || x.position - y.position);
    const its = items.filter((i) => i.course_id === course.id);
    const dates = vs.map((v) => v.last_verified_on).filter((d): d is string => !!d).sort();
    return {
      academyId: a.id, slug: a.slug, name: a.name, outcome: a.outcome, skills: skills.filter((s) => s.course_id === course.id).map((s) => s.name),
      audience: bps.find((b) => b.course_id === course.id && b.status === "approved")?.audience_level ?? null,
      tags: [...new Set(its.flatMap((i) => i.interests ?? []))],
      minutes: ls.reduce((n, l) => n + (l.minutes ?? 10), 0) + its.length * MINUTES_PER_ITEM,
      lastVerifiedOn: dates[0] ?? null, firstLessonId: ls[0]?.id ?? null, lessons: ls.length,
    };
  }).filter((c) => c.lessons > 0).sort((x, y) => x.name.localeCompare(y.name));
}

/** What the interview offers: topics (catalog topics and published courses) and interest tags. */
export async function interviewOptions() {
  const db = getDb();
  const courses = await publishedCourses();
  const catalog = ((await db.from("catalog_topics").select("slug, name").order("name", { ascending: true })).data ?? []) as { slug: string; name: string }[];
  const topics = [
    ...courses.map((c) => ({ slug: c.slug, name: c.name, hasCourse: true })),
    ...catalog.filter((t) => !courses.some((c) => c.slug === t.slug) && t.slug !== OWNER_ACADEMY_SLUG).map((t) => ({ slug: t.slug, name: t.name, hasCourse: false })),
  ];
  const interests = [...new Set([...BASE_INTERESTS, ...courses.flatMap((c) => c.tags)])].filter((t) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(t)).sort();
  return {
    goals: Object.entries(GOALS).map(([key, label]) => ({ key, label })), levels: Object.entries(LEVELS).map(([key, label]) => ({ key, label })),
    minutes: [...MINUTES], topics, interests,
  };
}

async function interviewRow(accountId: string): Promise<Row | null> {
  return (await getDb().from("learner_interviews").select("*").eq("account_id", accountId).maybeSingle()).data as Row | null;
}
export const answersOf = (r: Row | null): Answers | null =>
  r?.completed_at && r.goal && r.level && r.minutes_per_week
    ? { goal: r.goal as Answers["goal"], level: r.level as Answers["level"], minutesPerWeek: r.minutes_per_week, topics: r.topics ?? [], interests: r.interests ?? [] } : null;

/** For activity selection (L6 lessons): the learner's answers and whether they chose the default set. */
export async function activitySelection(accountId: string): Promise<{ answers: Answers; mode: string } | null> {
  const answers = answersOf(await interviewRow(accountId));
  if (!answers) return null;
  const path = (await getDb().from("learner_paths").select("activity_mode").eq("account_id", accountId).maybeSingle()).data as { activity_mode: string } | null;
  return { answers, mode: path?.activity_mode ?? "personal" };
}

const RankSchema = z.object({ order: z.array(z.object({ n: z.number().int(), why: z.string() })) });
const RANK_SYSTEM = [
  "You order published courses for a learner on a learning platform, from their four interview answers only.",
  "Return the course numbers that fit, best first, each with one short sentence on why it fits their goal, level, time or topics.",
  "Use only the numbered courses given. Don't invent courses. Don't describe anything as legally or attorney approved.",
].join("\n");

type Built = { method: "rules" | "ai_ranked"; note: string; items: { academyId: string; reason: string }[]; gaps: string[] };

/** Builds the path for these answers (rules, then an optional AI ordering). Writes it; records gap requests. */
async function buildPath(actor: Account, answers: Answers, requestId?: string): Promise<Built> {
  const plan = (await planOf(actor))!;
  const courses = await publishedCourses();
  const catalog = ((await getDb().from("catalog_topics").select("slug, name")).data ?? []) as { slug: string; name: string }[];
  const names: Record<string, string> = Object.fromEntries([...catalog, ...courses].map((t) => [t.slug, t.name]));
  const rules = pickCourses(answers, courses, "pro", names); // ranked list; the plan's limit is applied after any AI ordering
  let ranked = rules.chosen.map((c) => ({ slug: c.slug, reason: c.reasons.join(" ") }));
  let method: Built["method"] = "rules";
  let note = RULES_NOTE;
  if (ranked.length > 1) {
    if (!aiConfigured()) note = `${RULES_NOTE} AI ordering is off (AI isn't set up).`;
    else {
      const cands = ranked.map((r) => courses.find((c) => c.slug === r.slug)!);
      try {
        const out = await structured("paths.rank", {
          system: RANK_SYSTEM, user: rankPrompt(answers, names, cands), schema: RankSchema, maxTokens: 800,
          estimateUsd: estimateUsd("pathRank"), accountId: actor.id, requestId,
        });
        const order = out.order.filter((o, i, all) => o.n >= 1 && o.n <= cands.length && all.findIndex((x) => x.n === o.n) === i);
        if (order.length) {
          const rest = ranked.filter((_, i) => !order.some((o) => o.n === i + 1));
          ranked = [...order.map((o) => ({ slug: cands[o.n - 1].slug, reason: `${clean(o.why, 300)} ${ranked[o.n - 1].reason}`.trim() })), ...rest];
          method = "ai_ranked";
          note = AI_PATH_NOTICE;
        }
      } catch (err) {
        if (!(err instanceof AiUnavailable)) throw err;
        note = `${RULES_NOTE} AI ordering was skipped: ${err.code === "cap_reached" ? "the AI spending limit is reached" : err.code === "ai_off" ? "AI isn't set up" : "the AI didn't answer"}.`;
      }
    }
  }
  ranked = ranked.slice(0, PATH_LIMIT[plan]);
  const gaps = rules.gaps.filter((g) => names[g]);
  if (gaps.length) {
    for (const g of gaps) await getDb().rpc("request_course", { p_topic: names[g], p_key: g, p_level: answers.level });
    await recordAnonymousRequests(gaps.map((g) => names[g]), answers.level);
    note += ` No reviewed course exists yet for ${gaps.map((g) => `"${names[g]}"`).join(", ")}; the request was passed on to the course team, without your name.`;
  }
  if (plan === "basic" && rules.chosen.length > 1) note += " Your plan's path covers one subject; Pro adds more subjects.";
  return { method, note, items: ranked.map((r) => ({ academyId: courses.find((c) => c.slug === r.slug)!.academyId, reason: r.reason.slice(0, 500) })), gaps };
}

async function writePath(actor: Account, built: Built) {
  const db = getDb();
  let path = (await db.from("learner_paths").select("*").eq("account_id", actor.id).maybeSingle()).data as PathRow | null;
  const fields = { method: built.method, note: built.note.slice(0, 1000), built_at: new Date().toISOString() };
  if (path) {
    const { error } = await db.from("learner_paths").update(fields).eq("id", path.id);
    if (error) throw new Error(`path update failed: ${error.message}`);
    await db.from("learner_path_items").delete().eq("path_id", path.id);
  } else {
    const ins = await db.from("learner_paths").insert({ account_id: actor.id, activity_mode: "personal", ...fields }).select("*").single();
    if (ins.error) throw new Error(`path insert failed: ${ins.error.message}`);
    path = ins.data as PathRow;
  }
  if (built.items.length) {
    const { error } = await db.from("learner_path_items").insert(built.items.map((it, i) => ({ path_id: path!.id, account_id: actor.id, academy_id: it.academyId, position: i + 1, reason: it.reason })));
    if (error) throw new Error(`path items insert failed: ${error.message}`);
  }
}

/** The interview as the learner sees it: the questions, and their answers (private to them). */
export async function getInterview(actor: Account) {
  const r = await interviewRow(actor.id);
  return { options: await interviewOptions(), answers: answersOf(r), skipped: !!r?.skipped_at && !r.completed_at, plan: await planOf(actor) };
}

/** Saves the answers (from the lists shown) and builds the path. Body: { goal, level, minutesPerWeek, topics, interests }. */
export async function saveInterview(actor: Account, body: Record<string, unknown>, requestId?: string): Promise<Result> {
  const A = "learn.interview.save";
  const opts = await interviewOptions();
  const checked = checkAnswers(body, { topics: opts.topics.map((t) => t.slug), interests: opts.interests });
  if ("problem" in checked) return refused(400, checked.problem, A);
  const a = checked.answers;
  const db = getDb();
  const before = await interviewRow(actor.id);
  const fields = { goal: a.goal, level: a.level, minutes_per_week: a.minutesPerWeek, topics: a.topics, interests: a.interests, completed_at: new Date().toISOString(), skipped_at: null };
  const { error } = before ? await db.from("learner_interviews").update(fields).eq("id", before.id) : await db.from("learner_interviews").insert({ account_id: actor.id, ...fields });
  if (error) throw new Error(`interview save failed: ${error.message}`);
  const plan = await planOf(actor);
  const prevCount = await pathCount(actor.id);
  if (!plan) {
    return {
      ok: true, body: { saved: true, path: null, reason: "Your answers are saved. Choose a plan or start the free trial to get your path." },
      event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: before?.completed_at ? "answered" : "not answered", next: "answered (no plan yet, no path)", context: "Answered the interview (answers private; not recorded here)." },
    };
  }
  const built = await buildPath(actor, a, requestId);
  await writePath(actor, built);
  return {
    ok: true, body: { saved: true, path: await getPath(actor) },
    event: {
      action: "learn.path.build", result: "Completed", target: { type: "account", id: actor.id }, previous: `${prevCount} course(s) on the path`,
      next: `${built.items.length} course(s) (${built.method === "ai_ranked" ? "rules, ordered with AI" : "rules"})${built.gaps.length ? `, ${built.gaps.length} topic(s) without a course` : ""}`,
      context: `${before?.completed_at ? "Redid" : "Answered"} the interview and built the path from published courses only. The answers are private to the learner and not recorded here.`,
    },
  };
}

const pathCount = async (accountId: string) => (((await getDb().from("learner_path_items").select("id").eq("account_id", accountId)).data ?? []) as unknown[]).length;

/** Skip for now (redoable any time). Answers already given stay. */
export async function skipInterview(actor: Account): Promise<Result> {
  const A = "learn.interview.skip";
  const r = await interviewRow(actor.id);
  if (r?.completed_at) return refused(409, "You've already answered. Redo the interview from your path page.", A);
  const db = getDb();
  const { error } = r ? await db.from("learner_interviews").update({ skipped_at: new Date().toISOString() }).eq("id", r.id) : await db.from("learner_interviews").insert({ account_id: actor.id, skipped_at: new Date().toISOString() });
  if (error) throw new Error(`interview skip failed: ${error.message}`);
  return { ok: true, body: { skipped: true }, event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: "not answered", next: "skipped", context: "Skipped the interview for now." } };
}

/** Deletes the answers and the path (the learner's own choice; also covered by a Privacy Center deletion request). */
export async function deleteInterview(actor: Account): Promise<Result> {
  const db = getDb();
  const n = await pathCount(actor.id);
  await db.from("learner_path_items").delete().eq("account_id", actor.id);
  await db.from("learner_paths").delete().eq("account_id", actor.id);
  await db.from("learner_interviews").delete().eq("account_id", actor.id);
  return { ok: true, body: { deleted: true }, event: { action: "learn.interview.delete", result: "Completed", target: { type: "account", id: actor.id }, previous: `answered, ${n} course(s) on the path`, next: "none", context: "Deleted their interview answers and their path." } };
}

/** The path page: courses in order with why, time, last verified; the plan's limits; the activity mode. */
export async function getPath(actor: Account) {
  const db = getDb();
  const path = (await db.from("learner_paths").select("*").eq("account_id", actor.id).maybeSingle()).data as PathRow | null;
  const r = await interviewRow(actor.id);
  const answers = answersOf(r);
  const plan = await planOf(actor);
  const courses = await publishedCourses();
  const items = path ? (((await db.from("learner_path_items").select("*").eq("path_id", path.id).order("position", { ascending: true })).data ?? []) as ItemRow[]) : [];
  const perWeek = answers?.minutesPerWeek ?? 120;
  const view = items.map((it) => {
    const c = courses.find((x) => x.academyId === it.academy_id);
    return c ? {
      slug: c.slug, name: c.name, outcome: c.outcome, position: it.position, why: it.reason, minutes: c.minutes, weeks: weeksFor(c.minutes, perWeek),
      lastVerifiedOn: c.lastVerifiedOn, lessons: c.lessons, firstLessonId: c.firstLessonId,
    } : null; // A course that is no longer published drops off the path.
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const limit = plan ? PATH_LIMIT[plan] : 0;
  return {
    plan, limit, interview: answers ? { goal: GOALS[answers.goal], level: LEVELS[answers.level], minutesPerWeek: answers.minutesPerWeek } : null,
    interviewNeeded: !answers && !(r?.skipped_at), skipped: !!r?.skipped_at && !answers,
    method: path?.method ?? null, note: path?.note ?? null, aiNotice: path?.method === "ai_ranked" ? AI_PATH_NOTICE : null,
    activityMode: path?.activity_mode ?? "personal", builtAt: path?.built_at ?? null, courses: view,
    canAdd: !!plan && !!path && view.length < limit,
    addable: path && plan ? courses.filter((c) => !view.some((v) => v.slug === c.slug)).map((c) => ({ slug: c.slug, name: c.name })) : [],
  };
}

async function pathFor(actor: Account) {
  const db = getDb();
  const path = (await db.from("learner_paths").select("*").eq("account_id", actor.id).maybeSingle()).data as PathRow | null;
  const items = path ? (((await db.from("learner_path_items").select("*").eq("path_id", path.id).order("position", { ascending: true })).data ?? []) as ItemRow[]) : [];
  const academies = items.length ? (((await db.from("academies").select("id, slug").in("id", items.map((i) => i.academy_id))).data ?? []) as { id: string; slug: string }[]) : [];
  return { path, items: items.map((i) => ({ ...i, slug: academies.find((a) => a.id === i.academy_id)?.slug ?? "" })) };
}

/** Body: { order: [slug, ...] } with exactly the path's courses. */
export async function reorderPath(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.path.reorder";
  const { path, items } = await pathFor(actor);
  if (!path) return refused(404, "Take the interview first to get a path.", A);
  const order = Array.isArray(body.order) ? body.order : [];
  if (order.length !== items.length || !items.every((i) => order.includes(i.slug))) return refused(400, "Send every course on your path, in the new order.", A);
  const db = getDb();
  for (const it of items) {
    const { error } = await db.from("learner_path_items").update({ position: order.indexOf(it.slug) + 1 }).eq("id", it.id);
    if (error) throw new Error(`path reorder failed: ${error.message}`);
  }
  return { ok: true, body: await getPath(actor), event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: `${items.length} course(s)`, next: `${items.length} course(s), reordered`, context: "Reordered their path." } };
}

export async function removeFromPath(actor: Account, slug: string): Promise<Result> {
  const A = "learn.path.remove";
  const { path, items } = await pathFor(actor);
  const it = items.find((i) => i.slug === slug);
  if (!path || !it) return refused(404, "That course isn't on your path.", A);
  const db = getDb();
  const { error } = await db.from("learner_path_items").delete().eq("id", it.id);
  if (error) throw new Error(`path remove failed: ${error.message}`);
  for (const [n, rest] of items.filter((i) => i.id !== it.id).entries()) await db.from("learner_path_items").update({ position: n + 1 }).eq("id", rest.id);
  return { ok: true, body: await getPath(actor), event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: `${items.length} course(s)`, next: `${items.length - 1} course(s)`, context: "Removed a course from their path." } };
}

/** Body: { slug }. Only a published course; Basic (and the trial): one subject; Pro: up to 5. Checked here, on the server. */
export async function addToPath(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.path.add";
  const plan = await planOf(actor);
  if (!plan) return refused(403, "Choose a plan or start the free trial to get a path.", A);
  const { path, items } = await pathFor(actor);
  if (!path) return refused(404, "Take the interview first to get a path.", A);
  const course = (await publishedCourses()).find((c) => c.slug === body.slug);
  if (!course) return refused(404, "Only published courses can go on a path.", A);
  if (items.some((i) => i.slug === course.slug)) return refused(409, "That course is already on your path.", A);
  if (items.length >= PATH_LIMIT[plan]) {
    return refused(plan === "basic" ? 403 : 409, plan === "basic" ? "Your plan's path covers one subject. Remove it first, or Pro adds more subjects." : `A path holds up to ${PATH_LIMIT.pro} courses. Remove one first.`, A);
  }
  const { error } = await getDb().from("learner_path_items").insert({ path_id: path.id, account_id: actor.id, academy_id: course.academyId, position: items.length + 1, reason: "You added it." });
  if (error) throw new Error(`path add failed: ${error.message}`);
  return { ok: true, status: 201, body: await getPath(actor), event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: `${items.length} course(s)`, next: `${items.length + 1} course(s)`, context: "Added a published course to their path." } };
}

/** Body: { mode: "personal" | "default" }: practice picked for the learner, or every published item (the default set). */
export async function setActivityMode(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.path.activities";
  if (body.mode !== "personal" && body.mode !== "default") return refused(400, "Choose personal or default.", A);
  const { path } = await pathFor(actor);
  if (!path) return refused(404, "Take the interview first to get a path.", A);
  const previous = String(path.activity_mode);
  const { error } = await getDb().from("learner_paths").update({ activity_mode: body.mode }).eq("id", path.id);
  if (error) throw new Error(`activity mode failed: ${error.message}`);
  return { ok: true, body: { mode: body.mode }, event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous, next: String(body.mode), context: `Practice items: ${body.mode === "personal" ? "picked for them" : "the default set"}.` } };
}

// ============ Anonymous course requests ============

async function recordAnonymousRequests(topics: string[], level: string) {
  // Recorded by the system, never as the learner: the request queue and its audit trail hold no learner identity.
  await recordAudit({
    actor: SYSTEM_ACTOR("Anonymous course request"), action: "course_requests.add", result: "Completed", reason: "A learner asked for a topic with no published course",
    context: `Requested a course (anonymous): ${topics.map((t) => `"${t}"`).join(", ")} (${level}).`, target: { type: "course_request", id: topics.join(", ").slice(0, 200) },
    previous: null, next: "open",
  });
}

const topicKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** Body: { topic, level }. Anonymous: only the topic and level are kept, counted with others who asked the same. */
export async function requestCourse(body: Record<string, unknown>): Promise<Result> {
  const A = "course_requests.add";
  const raw = clean(body.topic, 80);
  if (raw.length < 3) return refused(400, "Name the topic in a few words.", A);
  if (!isLevel(body.level)) return refused(400, "Choose the level.", A);
  const red = redactPersonalData(raw);
  if (red.removed) return refused(400, "Leave out personal details (like an email, phone number or handle). Just the topic.", A);
  if (safetySignal(raw) || ATTORNEY.test(raw)) return refused(400, "Name a learning topic, in a few words.", A);
  const key = topicKey(raw);
  if (key.length < 3) return refused(400, "Name the topic in a few words.", A);
  const existing = (await publishedCourses()).find((c) => topicKey(c.name) === key || c.slug === key);
  if (existing) return { ok: true, body: { recorded: false, existing: { slug: existing.slug, name: existing.name }, message: `There's already a published course: ${existing.name}.` }, event: { action: A, result: "Completed", context: "" } };
  const { error } = await getDb().rpc("request_course", { p_topic: raw, p_key: key, p_level: body.level });
  if (error) throw new Error(`course request failed: ${error.message}`);
  await recordAnonymousRequests([raw], body.level);
  return { ok: true, status: 201, body: { recorded: true, message: `No reviewed course on "${raw}" exists yet. Your request was passed on to the course team, without your name.` }, event: { action: A, result: "Completed", context: "" } };
}

export async function listRequests(status: string | null) {
  let q = getDb().from("course_requests").select("id, topic, topic_key, level, request_count, status, decided_at, decision_note, last_requested_at, created_at");
  if (status === "open" || status === "planned" || status === "dismissed") q = q.eq("status", status);
  const rows = ((await q.order("last_requested_at", { ascending: false }).limit(200)).data ?? []) as
    { id: string; topic: string; topic_key: string; level: string; request_count: number; status: string; decided_at: string | null; decision_note: string | null; last_requested_at: string; created_at: string }[];
  return rows.sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.request_count - a.request_count)
    .map((r) => ({ id: r.id, topic: r.topic, key: r.topic_key, level: r.level, count: r.request_count, status: r.status, decidedAt: r.decided_at, note: r.decision_note, lastRequestedAt: r.last_requested_at, firstRequestedAt: r.created_at }));
}

/** Course Admins: mark a request planned or dismissed (the reason comes with the request). Body: { status }. */
export async function decideRequest(actor: Account, id: string, body: Record<string, unknown>, reason: string): Promise<Result> {
  const A = "course_requests.manage";
  if (!isUuid(id)) return refused(404, "No such request.", A);
  if (body.status !== "planned" && body.status !== "dismissed" && body.status !== "open") return refused(400, "Choose planned, dismissed or open.", A);
  const db = getDb();
  const row = (await db.from("course_requests").select("id, topic, level, status").eq("id", id).maybeSingle()).data as { id: string; topic: string; level: string; status: string } | null;
  if (!row) return refused(404, "No such request.", A);
  const target = { type: "course_request", id, label: `${row.topic} (${row.level})` };
  if (row.status === body.status) return refused(409, `This request is already ${row.status}.`, A, target);
  const previous = row.status;
  const fields = body.status === "open" ? { status: "open", decided_at: null, decided_by_account_id: null, decision_note: null }
    : { status: body.status, decided_at: new Date().toISOString(), decided_by_account_id: actor.id, decision_note: reason };
  const { error } = await db.from("course_requests").update(fields).eq("id", id);
  if (error) throw new Error(`request decision failed: ${error.message}`);
  return { ok: true, body: { id, status: body.status }, event: { action: A, result: "Completed", target, previous, next: String(body.status), context: `Marked the request for "${row.topic}" (${row.level}) ${body.status}.` } };
}
