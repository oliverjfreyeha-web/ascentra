import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid, refused, type Result } from "@/lib/courses/common";
import { learnerSlot } from "@/lib/courses/videos";
import { missionGate, spendContactApproval } from "@/lib/missions";
import { DEFAULT_TIME_ZONE, IMPORTANCE, MISSION_TYPES, TEEN_MISSION_LIMITS, isMissionType } from "./config";
import { courseState, itemGate, lessonGate, planOf, recordCompletion, totalsOf, type ItemRef } from "./progress";
import { localDay, pointsFor, rankOf, streaks } from "./rules";

/**
 * C2: the learner's side of progress. Finishing items (a video watched to the end, a practice task marked done after
 * trying it; quizzes are recorded by the attempt itself at 80% or more), the lesson's item states and labels, the
 * once-per-course notices, the time zone the streak uses, and "My progress".
 */

const noAudit = (action: string) => ({ action, result: "Completed" as const, context: "" });

/** Body: { timeZone }. The learner's own time zone (their day ends at their midnight). */
export async function setTimeZone(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.time_zone";
  const tz = typeof body.timeZone === "string" ? body.timeZone.trim() : "";
  let valid = false;
  try { valid = !!tz && new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone.length > 0; } catch { valid = false; }
  if (!valid || tz.length > 64) return refused(400, "That isn't a time zone.", A);
  const { error } = await getDb().from("profiles").update({ time_zone: tz }).eq("account_id", actor.id);
  if (error) return refused(400, "That time zone isn't known here.", A);
  return { ok: true, body: { timeZone: tz }, event: noAudit(A) };
}

/** A video watched to the end (the player says so; the link was the learner's own, for an open item). */
export async function videoWatched(actor: Account, slotId: string): Promise<Result> {
  const A = "learn.video.watched";
  const slot = await learnerSlot(actor, slotId);
  if (!slot || slot.status !== "approved") return refused(404, "No such video.", A);
  const gate = await itemGate(actor, "video", slot.id, slot.module_id);
  if (!gate.ok) return refused(403, gate.reason, A);
  const created = await recordCompletion(actor, gate.item, gate.state.course.id);
  return { ok: true, body: { done: true, new: created, points: gate.item.points }, event: noAudit(A) };
}

/**
 * A practice task, assignment or sandbox marked done, after trying it at least once. A real-world mission is checked
 * for teens first (state, Guardian approval). Quizzes aren't marked done here: 80% on the quiz does it.
 */
export async function completeActivity(actor: Account, itemId: string): Promise<Result> {
  const A = "learn.activity.complete";
  if (!isUuid(itemId)) return refused(404, "No such practice item.", A);
  const db = getDb();
  const item = (await db.from("activity_items").select("id, module_id, grading, status, mission_type").eq("id", itemId).maybeSingle()).data as
    { id: string; module_id: string; grading: string; status: string; mission_type: string | null } | null;
  if (!item || item.status !== "published") return refused(404, "No such practice item.", A);
  if (item.grading === "code") return refused(409, "A quiz counts as done when you score 80% or more on it.", A);
  const gate = await itemGate(actor, "activity", item.id, item.module_id);
  if (!gate.ok) return refused(403, gate.reason, A);
  const tried = ((await db.from("activity_attempts").select("id").eq("item_id", item.id).eq("account_id", actor.id).limit(1)).data ?? []).length > 0;
  if (!tried) return refused(409, "Try it first, then mark it done.", A);
  if (item.mission_type) {
    const m = await missionGate(actor, item.mission_type, gate.state.course.academyId, item.id);
    if (!m.ok) return refused(403, m.reason, A);
  }
  const created = await recordCompletion(actor, gate.item, gate.state.course.id);
  // A contact mission's approval is used once.
  if (created && actor.isMinor && isMissionType(item.mission_type) && MISSION_TYPES[item.mission_type].contacts) await spendContactApproval(actor.id, gate.state.course.academyId, item.id);
  return { ok: true, body: { done: true, new: created, points: gate.item.points }, event: noAudit(A) };
}

/** After a graded attempt: 80% or more records the quiz as done. Called by the attempt itself. */
export async function quizPassed(actor: Account, item: ItemRef, courseId: string) {
  return recordCompletion(actor, item, courseId);
}

/**
 * What the lesson page shows from C2: each item's label, whether it's open and done (and why not open), the notices
 * still to show for this course (each once: shown now, so not again), and the course's module state.
 */
export async function lessonExtras(actor: Account, lessonId: string) {
  const db = getDb();
  const lesson = (await db.from("lessons").select("id, module_id").eq("id", lessonId).maybeSingle()).data as { id: string; module_id: string } | null;
  if (!lesson) return null;
  const mod = (await db.from("modules").select("course_id").eq("id", lesson.module_id).maybeSingle()).data as { course_id: string } | null;
  const st = mod ? await courseState(actor, mod.course_id) : null;
  if (!st) return null;
  const m = st.modules.find((x) => x.id === lesson.module_id)!;
  const items = m.items.filter((i) => i.lessonId === lesson.id || (i.kind === "video" && !i.lessonId));
  const notices: { kind: "license" | "software"; text: string }[] = [];
  for (const [kind, text] of [["license", st.notices.license], ["software", st.notices.software]] as const) {
    if (!text) continue;
    const { error } = await db.from("course_notice_views").insert({ account_id: actor.id, academy_id: st.course.academyId, notice_kind: kind });
    if (!error) notices.push({ kind, text });
    else if (error.code !== "23505") throw new Error(`notice view failed: ${error.message}`);
  }
  return {
    module: { position: m.position, title: m.title, state: m.state, reason: m.reason, doneCount: m.doneCount, itemCount: m.itemCount },
    items: items.map((i) => ({
      kind: i.kind, id: i.id, importance: i.importance, importanceLabel: i.importance ? IMPORTANCE[i.importance].label : null, done: i.done, open: i.open, missionType: i.missionType,
      mission: isMissionType(i.missionType) ? { label: MISSION_TYPES[i.missionType].label, contacts: MISSION_TYPES[i.missionType].contacts } : null,
    })),
    notices,
    rank: { name: st.rank.name, index: st.rank.index },
    // A teen's real-world missions need their Guardian; these limits always apply to them.
    teen: actor.isMinor, missionLimits: actor.isMinor ? TEEN_MISSION_LIMITS : [],
  };
}

export { lessonGate };

/** "My progress": rank, streak, every course with its modules (and why a locked one is locked), skills, scores over time. */
export async function myProgress(actor: Account, now = new Date()) {
  const db = getDb();
  const totals = await totalsOf(actor.id);
  const rank = rankOf(totals.points);
  const { plan } = await planOf(actor);
  const profile = (await db.from("profiles").select("time_zone").eq("account_id", actor.id).maybeSingle()).data as { time_zone: string | null } | null;
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE;
  // The learner's picks and the courses linked to them.
  const picks = ((await db.from("learner_picks").select("topic_id, kind, status").eq("user_id", actor.id)).data ?? []) as { topic_id: string; kind: string; status: string }[];
  const topics = picks.length ? ((await db.from("topics").select("id, kind, slug, name, catalog_slug").in("id", picks.map((p) => p.topic_id))).data ?? []) as
    { id: string; kind: string; slug: string; name: string; catalog_slug: string | null }[] : [];
  const completions = ((await db.from("item_completions").select("course_id, points, local_day, completed_at").eq("account_id", actor.id)).data ?? []) as { course_id: string; points: number; local_day: string; completed_at: string }[];
  const courseIdsDone = [...new Set(completions.map((c) => c.course_id))];
  const slugs = topics.map((t) => t.catalog_slug).filter((x): x is string => !!x);
  const academies = ((await db.from("academies").select("id, slug, name").in("slug", slugs.length ? slugs : ["-"])).data ?? []) as { id: string; slug: string; name: string }[];
  const fromDone = courseIdsDone.length ? ((await db.from("courses").select("academy_id").in("id", courseIdsDone)).data ?? []) as { academy_id: string }[] : [];
  const academyIds = [...new Set([...academies.map((a) => a.id), ...fromDone.map((c) => c.academy_id)])];
  const courses = [];
  for (const academyId of academyIds) {
    const live = (((await db.from("courses").select("id, version, status").eq("academy_id", academyId)).data ?? []) as { id: string; version: number; status: string }[])
      .filter((c) => c.status === "published" || c.status === "restored").sort((a, b) => b.version - a.version)[0];
    if (!live) continue;
    const st = await courseState(actor, live.id, now);
    if (!st) continue;
    const a = academies.find((x) => x.id === academyId) ?? ((await db.from("academies").select("id, slug, name").eq("id", academyId).maybeSingle()).data as { id: string; slug: string; name: string });
    const topic = topics.find((t) => t.catalog_slug === a.slug);
    const pick = topic ? picks.find((p) => p.topic_id === topic.id) : null;
    const items = st.modules.reduce((n, m) => n + m.itemCount, 0);
    const done = st.modules.reduce((n, m) => n + m.doneCount, 0);
    const coursePoints = completions.filter((c) => c.course_id === live.id).reduce((s, c) => s + c.points, 0);
    courses.push({
      courseId: live.id, slug: a.slug, name: a.name, kind: topic?.kind ?? null, pickStatus: pick?.status ?? null, tier: st.course.tierLabel, plan,
      percent: items ? Math.round((done / items) * 100) : 0, done, items, complete: st.complete, bonus: st.bonus,
      capstone: st.capstone, points: coursePoints, skillRank: topic?.kind === "skill" ? rankOf(coursePoints) : null,
      modules: st.modules.map((m) => ({ position: m.position, title: m.title, state: m.state, reason: m.reason, gated: m.gated, done: m.done, doneCount: m.doneCount, itemCount: m.itemCount })),
    });
  }
  // Scores over time: the best score per quiz, by day; and points per day for the last 30 days.
  const attempts = ((await db.from("activity_attempts").select("score, created_at, graded_by").eq("account_id", actor.id).eq("graded_by", "code")).data ?? []) as { score: number | string | null; created_at: string }[];
  const scoreDays = new Map<string, number[]>();
  for (const at of attempts) if (at.score != null) {
    const d = localDay(new Date(at.created_at), tz);
    scoreDays.set(d, [...(scoreDays.get(d) ?? []), Number(at.score)]);
  }
  const today = localDay(now, tz);
  const pointsByDay = new Map<string, number>();
  for (const c of completions) pointsByDay.set(c.local_day, (pointsByDay.get(c.local_day) ?? 0) + c.points);
  const check = streaks(completions.map((c) => c.local_day), today);
  return {
    rank: { index: rank.index, name: rank.name, points: totals.points, next: rank.next },
    // The database's streak and this one agree (tests check both); the database's is what the leaderboard shows.
    streak: { current: totals.current, longest: Math.max(totals.longest, check.longest) },
    plan,
    courses: courses.filter((c) => c.pickStatus !== "paused" || plan === "pro" || plan === "full"),
    pastCourses: plan === "pro" || plan === "full" ? courses.filter((c) => c.pickStatus === "paused").map((c) => c.slug) : [],
    skills: courses.filter((c) => c.kind === "skill").map((c) => ({ slug: c.slug, name: c.name, percent: c.percent, rank: c.skillRank })),
    scores: [...scoreDays.entries()].sort().slice(-30).map(([day, s]) => ({ day, average: Math.round((s.reduce((x, y) => x + y, 0) / s.length) * 100), attempts: s.length })),
    pointsByDay: [...pointsByDay.entries()].sort().slice(-30).map(([day, points]) => ({ day, points })),
    timeZone: tz,
    note: "Ranks and streaks come from items you finish. Results vary. Nothing here promises income.",
    weights: Object.fromEntries(Object.entries(IMPORTANCE).map(([k, v]) => [k, v.points])),
    pointsFor: { shouldKnow: pointsFor("should_know"), important: pointsFor("important"), veryImportant: pointsFor("very_important") },
  };
}
