import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { tierOf } from "@/lib/billing";
import { shownItems } from "@/lib/activities/learn";
import { SIZE_TIERS, isSizeTier, type SizeTier } from "@/lib/courses/structure";
import { CAPSTONE_POINTS, IMPORTANCE, isImportance, type Importance } from "./config";
import {
  courseComplete, earnsTrialBonus, moduleDone, notebookCategory, pointsFor, rankOf, unlockModules, type ModuleInput, type ModuleUnlock, type PlanKind,
} from "./rules";

/**
 * C2: where a learner stands in a course, decided on the server: the module's items in order (videos, then the lesson's
 * practice, lesson by lesson), which are done, which are open (lib/progress/rules.ts), the trial bonus, the capstone.
 * Courses with a size tier (C2 courses) use the unlock rules; older courses stay fully open as before.
 *
 * Progress follows the course across versions: a finished item counts for the same item in a newer version (matched by
 * module and lesson position, and the item's idea and type; a video by module and slot position).
 */

export type ItemRef = {
  kind: "video" | "activity"; id: string; lessonId: string | null; moduleId: string; title: string; importance: Importance | null; points: number;
  part: string | null; itemType: string | null; grading: string | null; notebookNote: string | null; missionType: string | null; key: string;
};
type CourseRow = { id: string; academy_id: string; version: number; status: string; size_tier: string | null; license_notice?: string | null; software_notice?: string | null };
type ModuleRow = { id: string; course_id: string; position: number; title: string };
type LessonRow = { id: string; module_id: string; position: number; title: string };
type SlotRow = { id: string; module_id: string; lesson_id: string | null; position: number; title: string; status: string; importance: string | null; notebook_note: string | null };
type ItemRow = { id: string; lesson_id: string; module_id: string; idea_key: string; item_type: string; grading: string; recipe_part: string | null; prompt: string;
  importance?: string | null; notebook_note?: string | null; mission_type?: string | null };

const NONE = ["00000000-0000-4000-8000-000000000000"];
const ids = (xs: string[]) => (xs.length ? xs : NONE);

/** The learner's plan for the unlock rules, and when their trial started. */
export async function planOf(actor: Pick<Account, "id" | "roleKey">): Promise<{ plan: PlanKind; trialStart: Date | null }> {
  const { tier } = await tierOf(actor);
  const plan: PlanKind = tier === "full" ? "full" : tier === "pro" ? "pro" : tier === "basic" ? "basic" : tier === "trial" ? "trial" : "none";
  if (plan !== "trial") return { plan, trialStart: null };
  const rows = ((await getDb().from("entitlements").select("tier, valid_from").eq("account_id", actor.id)).data ?? []) as { tier: string; valid_from: string }[];
  const start = rows.filter((r) => r.tier === "trial").map((r) => r.valid_from).sort()[0];
  return { plan, trialStart: start ? new Date(start) : null };
}

/** Points, current and longest streak, from the database's own computation (never from the browser). */
export async function totalsOf(accountId: string): Promise<{ points: number; current: number; longest: number }> {
  const { data, error } = await getDb().rpc("learner_progress_totals", { p_account: accountId });
  if (error) throw new Error(`progress totals failed: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as { points: number | string; current_streak: number; longest_streak: number } | undefined;
  return { points: Number(r?.points ?? 0), current: Number(r?.current_streak ?? 0), longest: Number(r?.longest_streak ?? 0) };
}

const actKey = (modulePos: number, lessonPos: number, idea: string, type: string) => `a:${modulePos}:${lessonPos}:${idea}:${type}`;
const vidKey = (modulePos: number, slotPos: number) => `v:${modulePos}:${slotPos}`;

/** A module's items for this learner, in order: the module's general videos first, then each lesson's videos and practice. */
async function moduleItems(actor: Account, m: ModuleRow, lessons: LessonRow[], slots: SlotRow[]): Promise<ItemRef[]> {
  const out: ItemRef[] = [];
  const video = (s: SlotRow): ItemRef => {
    const importance = isImportance(s.importance) ? s.importance : null;
    return { kind: "video", id: s.id, lessonId: s.lesson_id, moduleId: m.id, title: s.title, importance, points: pointsFor(importance), part: "video", itemType: null,
      grading: null, notebookNote: s.notebook_note, missionType: null, key: vidKey(m.position, s.position) };
  };
  // Only approved videos are items a learner can finish ("Video coming" isn't one).
  const ready = slots.filter((s) => s.module_id === m.id && s.status === "approved").sort((a, b) => a.position - b.position);
  for (const s of ready.filter((x) => !x.lesson_id)) out.push(video(s));
  for (const l of lessons.filter((x) => x.module_id === m.id).sort((a, b) => a.position - b.position)) {
    for (const s of ready.filter((x) => x.lesson_id === l.id)) out.push(video(s));
    const { items } = await shownItems(actor, l.id);
    for (const i of items as unknown as ItemRow[]) {
      const importance = isImportance(i.importance) ? i.importance : null;
      out.push({ kind: "activity", id: i.id, lessonId: l.id, moduleId: m.id, title: i.prompt.slice(0, 140), importance, points: pointsFor(importance), part: i.recipe_part,
        itemType: i.item_type, grading: i.grading, notebookNote: i.notebook_note ?? null, missionType: i.mission_type ?? null, key: actKey(m.position, l.position, i.idea_key, i.item_type) });
    }
  }
  return out;
}

/** What this learner has finished in any version of the course: item ids and the keys that carry across versions. */
async function finished(accountId: string, courseIds: string[]) {
  const db = getDb();
  const rows = ((await db.from("item_completions").select("item_kind, item_id, module_id, lesson_id, completed_at").eq("account_id", accountId).in("course_id", ids(courseIds))).data ?? []) as
    { item_kind: string; item_id: string; module_id: string | null; lesson_id: string | null; completed_at: string }[];
  const done = new Set(rows.map((r) => r.item_id));
  const keys = new Set<string>();
  const acts = rows.filter((r) => r.item_kind === "activity").map((r) => r.item_id);
  const vids = rows.filter((r) => r.item_kind === "video").map((r) => r.item_id);
  const modIds = [...new Set(rows.map((r) => r.module_id).filter((x): x is string => !!x))];
  const lesIds = [...new Set(rows.map((r) => r.lesson_id).filter((x): x is string => !!x))];
  if (acts.length || vids.length) {
    const mods = ((await db.from("modules").select("id, position").in("id", ids(modIds))).data ?? []) as { id: string; position: number }[];
    const less = ((await db.from("lessons").select("id, position").in("id", ids(lesIds))).data ?? []) as { id: string; position: number }[];
    const pos = (list: { id: string; position: number }[], id: string | null) => list.find((x) => x.id === id)?.position ?? 0;
    const items = ((await db.from("activity_items").select("id, idea_key, item_type, module_id, lesson_id").in("id", ids(acts))).data ?? []) as { id: string; idea_key: string; item_type: string; module_id: string; lesson_id: string }[];
    for (const i of items) keys.add(actKey(pos(mods, i.module_id), pos(less, i.lesson_id), i.idea_key, i.item_type));
    const slots = ((await db.from("video_slots").select("id, module_id, position").in("id", ids(vids))).data ?? []) as { id: string; module_id: string; position: number }[];
    for (const s of slots) keys.add(vidKey(pos(mods, s.module_id), s.position));
  }
  return { done, keys, capstone: rows.some((r) => r.item_kind === "capstone"), rows };
}

export type CourseState = Awaited<ReturnType<typeof courseState>>;

/** One course, for one learner: modules, items (done, open), unlock reasons, the capstone and whether it is complete. */
export async function courseState(actor: Account, courseId: string, now = new Date()) {
  const db = getDb();
  const course = (await db.from("courses").select("id, academy_id, version, status, size_tier, license_notice, software_notice").eq("id", courseId).maybeSingle()).data as CourseRow | null;
  if (!course) return null;
  const versions = ((await db.from("courses").select("id").eq("academy_id", course.academy_id)).data ?? []) as { id: string }[];
  const modules = (((await db.from("modules").select("id, course_id, position, title").eq("course_id", course.id)).data ?? []) as ModuleRow[]).sort((a, b) => a.position - b.position);
  const lessons = ((await db.from("lessons").select("id, module_id, position, title").in("module_id", ids(modules.map((m) => m.id)))).data ?? []) as LessonRow[];
  const slots = ((await db.from("video_slots").select("id, module_id, lesson_id, position, title, status, importance, notebook_note").in("module_id", ids(modules.map((m) => m.id)))).data ?? []) as SlotRow[];
  const items = new Map<string, ItemRef[]>();
  for (const m of modules) items.set(m.id, await moduleItems(actor, m, lessons, slots));
  const fin = await finished(actor.id, versions.map((v) => v.id));
  const isDone = (i: ItemRef) => fin.done.has(i.id) || fin.keys.has(i.key);
  const inputs: ModuleInput[] = modules.map((m) => {
    const list = items.get(m.id)!;
    return { position: m.position, items: list.length, done: list.map(isDone), points: list.reduce((s, i) => s + i.points, 0) };
  });
  const tier: SizeTier | null = isSizeTier(course.size_tier) ? course.size_tier : null;
  const { plan, trialStart } = await planOf(actor);
  const totals = await totalsOf(actor.id);
  const rank = rankOf(totals.points);
  let bonus = !!((await db.from("trial_bonuses").select("id").eq("account_id", actor.id).eq("academy_id", course.academy_id).limit(1)).data ?? []).length;
  if (!bonus && tier && earnsTrialBonus({ tier, plan, modules: inputs, trialStart, now })) {
    // Earned now: kept, after they convert too.
    const { error } = await db.from("trial_bonuses").insert({ account_id: actor.id, academy_id: course.academy_id, course_id: course.id });
    if (error && error.code !== "23505") throw new Error(`trial bonus failed: ${error.message}`);
    bonus = true;
  }
  // Older courses (no size tier) keep their earlier behaviour: every module open.
  const unlock: ModuleUnlock[] = tier
    ? unlockModules({ tier, plan, modules: inputs, rank: rank.index, bonus })
    : inputs.map((m) => ({ position: m.position, state: "open", openItems: m.items, gated: false, requiredRank: null, reason: null, bonusHalf: false }));
  const capstone = (await db.from("course_capstones").select("id, title").eq("course_id", course.id).maybeSingle()).data as { id: string; title: string } | null;
  const allDone = courseComplete(inputs, fin.capstone);
  return {
    course: { id: course.id, academyId: course.academy_id, version: course.version, tier, tierLabel: tier ? SIZE_TIERS[tier].label : null },
    plan, trialStart: trialStart?.toISOString() ?? null, bonus, rank, totals,
    modules: modules.map((m, i) => {
      const list = items.get(m.id)!;
      const u = unlock[i];
      return {
        id: m.id, position: m.position, title: m.title, state: u.state, reason: u.reason, gated: u.gated, requiredRank: u.requiredRank, bonusHalf: u.bonusHalf,
        done: moduleDone(inputs[i]), doneCount: inputs[i].done.filter(Boolean).length, itemCount: list.length,
        items: list.map((it, k) => ({ ...it, done: isDone(it), open: k < u.openItems })),
      };
    }),
    capstone: capstone ? { id: capstone.id, title: capstone.title, done: fin.capstone } : null,
    complete: allDone,
    notices: { license: course.license_notice ?? null, software: course.software_notice ?? null },
  };
}

/** The live course a lesson, video or item belongs to. */
async function courseIdOfModule(moduleId: string): Promise<string | null> {
  return ((await getDb().from("modules").select("course_id").eq("id", moduleId).maybeSingle()).data as { course_id: string } | null)?.course_id ?? null;
}

/** Whether this learner may use an item now (C2 courses: the unlock rules; older courses: always). With the item and course. */
export async function itemGate(actor: Account, kind: "video" | "activity", itemId: string, moduleId: string) {
  const courseId = await courseIdOfModule(moduleId);
  if (!courseId) return { ok: false as const, reason: "No such item." };
  const st = await courseState(actor, courseId);
  if (!st) return { ok: false as const, reason: "No such item." };
  const m = st.modules.find((x) => x.id === moduleId);
  const it = m?.items.find((x) => x.kind === kind && x.id === itemId);
  if (!m || !it) return { ok: false as const, reason: "This item isn't part of your course view." };
  if (!it.open) return { ok: false as const, reason: m.reason ?? "This part isn't open yet." };
  return { ok: true as const, item: it, state: st, module: m };
}

/** Whether a lesson may be read: its module is at least half open (C2 courses). */
export async function lessonGate(actor: Account, lessonId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const l = (await getDb().from("lessons").select("module_id").eq("id", lessonId).maybeSingle()).data as { module_id: string } | null;
  if (!l) return { ok: true };
  const courseId = await courseIdOfModule(l.module_id);
  const c = courseId ? ((await getDb().from("courses").select("size_tier").eq("id", courseId).maybeSingle()).data as { size_tier: string | null } | null) : null;
  if (!c?.size_tier) return { ok: true };
  const st = await courseState(actor, courseId!);
  const m = st?.modules.find((x) => x.id === l.module_id);
  return !m || m.state !== "locked" ? { ok: true } : { ok: false, reason: m.reason ?? "This module isn't open yet." };
}

/**
 * Records a finished item once (points by its label, on the learner's own day) and, for a "Very important" item with a
 * Notebook note, adds the note to their Notebook. Returns whether it was new.
 */
export async function recordCompletion(actor: Account, it: ItemRef, courseId: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.rpc("record_item_completion", {
    p_account: actor.id, p_kind: it.kind, p_item: it.id, p_course: courseId, p_module: it.moduleId, p_lesson: it.lessonId, p_importance: it.importance, p_points: it.points,
  });
  if (error) throw new Error(`completion failed: ${error.message}`);
  const created = !!(data as { created?: boolean } | null)?.created;
  if (created && it.importance === "very_important" && it.notebookNote) {
    const course = (await db.from("courses").select("academy_id").eq("id", courseId).maybeSingle()).data as { academy_id: string } | null;
    const { error: e2 } = await db.from("notebook_entries").insert({
      account_id: actor.id, academy_id: course?.academy_id, course_id: courseId, item_kind: it.kind, item_id: it.id,
      category: notebookCategory(it.kind, it.part, it.itemType), importance: it.importance, title: it.title.slice(0, 300), note: it.notebookNote,
    });
    if (e2 && e2.code !== "23505") throw new Error(`notebook entry failed: ${e2.message}`);
  }
  return created;
}

/** Records the capstone (points: CAPSTONE_POINTS). */
export async function recordCapstone(actor: Account, capstoneId: string, courseId: string): Promise<boolean> {
  const { data, error } = await getDb().rpc("record_item_completion", {
    p_account: actor.id, p_kind: "capstone", p_item: capstoneId, p_course: courseId, p_module: null, p_lesson: null, p_importance: null, p_points: CAPSTONE_POINTS,
  });
  if (error) throw new Error(`capstone completion failed: ${error.message}`);
  return !!(data as { created?: boolean } | null)?.created;
}

export const IMPORTANCE_LABEL = Object.fromEntries(Object.entries(IMPORTANCE).map(([k, v]) => [k, v.label])) as Record<Importance, string>;

/**
 * The gate for a practice attempt: in a C2 course, the item must be open to this learner; in an older course every
 * published item is, as before. Returns the item (for its points and Notebook note) and its course.
 */
export async function activityGate(actor: Account, item: { id: string; module_id: string; course_id: string; lesson_id: string; prompt: string; item_type: string; grading: string;
  recipe_part?: string | null; importance?: string | null; notebook_note?: string | null; mission_type?: string | null; idea_key?: string }):
  Promise<{ ok: true; ref: ItemRef; courseId: string } | { ok: false; reason: string }> {
  const c = (await getDb().from("courses").select("size_tier").eq("id", item.course_id).maybeSingle()).data as { size_tier: string | null } | null;
  if (c?.size_tier) {
    const g = await itemGate(actor, "activity", item.id, item.module_id);
    return g.ok ? { ok: true, ref: g.item, courseId: g.state.course.id } : g;
  }
  const importance = isImportance(item.importance) ? item.importance : null;
  return {
    ok: true, courseId: item.course_id,
    ref: { kind: "activity", id: item.id, lessonId: item.lesson_id, moduleId: item.module_id, title: item.prompt.slice(0, 140), importance, points: pointsFor(importance),
      part: item.recipe_part ?? null, itemType: item.item_type, grading: item.grading, notebookNote: item.notebook_note ?? null, missionType: item.mission_type ?? null, key: `a:${item.id}` },
  };
}
