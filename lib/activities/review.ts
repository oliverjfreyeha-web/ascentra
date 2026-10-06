import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { ATTORNEY, NO_ATTORNEY, canSeeCourse, clean, courseScope, isUuid, refused, type Result } from "@/lib/courses/common";
import { diffLines } from "@/lib/courses/lessons";
import { LEVELS, MIN_MODULE_TYPES, TYPE_LABEL, checkItem, itemLines, varietyOf, type AnswerKey, type Content, type ItemType } from "./types";

/**
 * L6: the Reviewer's tools for the activity library: every item of a course by lesson with counts by type and level,
 * the diff against the item a refreshed draft would replace, editing a Draft, approving or rejecting it, publishing a
 * module's approved items (only with at least 3 different activity types: the database refuses otherwise), and the
 * common misses per lesson (counts only, never who). Every action is audited by the route with previous and new values.
 */
export type ItemRow = {
  id: string; lesson_id: string; module_id: string; course_id: string; idea_key: string; version: number; previous_item_id: string | null;
  status: string; item_type: ItemType; grading: "code" | "feedback"; level: string; goal: string; interests: string[]; prompt: string;
  content: Content; answer_key: AnswerKey; explanation: string; citation: { sourceId: string; title: string; url: string | null; quote?: string };
  generated_by: string; model: string | null; review_note: string | null; reviewed_at: string | null; published_at: string | null; created_at: string;
};

const counts = (items: ItemRow[]) => {
  const byType: Record<string, number> = {};
  const byLevel: Record<string, number> = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const i of items) {
    byType[i.item_type] = (byType[i.item_type] ?? 0) + 1;
    byLevel[i.level] = (byLevel[i.level] ?? 0) + 1;
  }
  return { byType, byLevel };
};

/** Types that would be live in a module after publishing its approved items (approved, plus published ones not being replaced). */
export function moduleVariety(items: Pick<ItemRow, "id" | "status" | "item_type" | "previous_item_id">[]) {
  const replaced = new Set(items.filter((i) => i.status === "approved" && i.previous_item_id).map((i) => i.previous_item_id));
  const live = items.filter((i) => i.status === "approved" || (i.status === "published" && !replaced.has(i.id)));
  const published = items.filter((i) => i.status === "published");
  return { ...varietyOf(live), publishedTypes: varietyOf(published).types, approved: items.filter((i) => i.status === "approved").length, min: MIN_MODULE_TYPES };
}

const view = (i: ItemRow, all: ItemRow[]) => {
  const prev = i.previous_item_id ? all.find((p) => p.id === i.previous_item_id) : null;
  return {
    id: i.id, ideaKey: i.idea_key, version: i.version, status: i.status, type: i.item_type, typeLabel: TYPE_LABEL[i.item_type], grading: i.grading,
    level: i.level, goal: i.goal, interests: i.interests, prompt: i.prompt, content: i.content, answerKey: i.answer_key, explanation: i.explanation,
    citation: i.citation, generatedBy: i.generated_by, model: i.model, reviewNote: i.review_note, reviewedAt: i.reviewed_at, publishedAt: i.published_at,
    replaces: prev ? { id: prev.id, version: prev.version, status: prev.status } : null,
    diff: prev ? diffLines(itemLines(prev), itemLines(i)) : null,
  };
};

/** The library for a course's newest version, by module and lesson. */
export async function courseActivities(actor: Account, slug: string) {
  if (!canSeeCourse(actor, slug)) return null;
  const db = getDb();
  const academy = (await db.from("academies").select("id, slug, name").eq("slug", slug).maybeSingle()).data as { id: string; slug: string; name: string } | null;
  if (!academy) return null;
  const course = (((await db.from("courses").select("id, version, status").eq("academy_id", academy.id)).data ?? []) as { id: string; version: number; status: string }[])
    .sort((a, b) => b.version - a.version)[0];
  if (!course) return { course: { slug, name: academy.name }, modules: [] };
  const mods = ((await db.from("modules").select("id, position, title").eq("course_id", course.id).order("position", { ascending: true })).data ?? []) as { id: string; position: number; title: string }[];
  const lessons = mods.length ? (((await db.from("lessons").select("id, module_id, position, title").in("module_id", mods.map((m) => m.id)).order("position", { ascending: true })).data ?? []) as
    { id: string; module_id: string; position: number; title: string }[]) : [];
  const items = lessons.length ? (((await db.from("activity_items").select("*").in("lesson_id", lessons.map((l) => l.id)).order("created_at", { ascending: true })).data ?? []) as ItemRow[]) : [];
  const live = (rows: ItemRow[]) => rows.filter((i) => i.status !== "archived" && i.status !== "rejected");
  return {
    course: { slug, name: academy.name, version: course.version, status: course.status },
    modules: mods.map((m) => {
      const mi = items.filter((i) => i.module_id === m.id);
      return {
        id: m.id, title: m.title, variety: moduleVariety(mi),
        lessons: lessons.filter((l) => l.module_id === m.id).map((l) => {
          const li = items.filter((i) => i.lesson_id === l.id);
          return {
            id: l.id, title: l.title, counts: counts(live(li)),
            items: li.filter((i) => i.status !== "archived").map((i) => view(i, items)),
          };
        }),
      };
    }),
  };
}

async function itemInCourse(slug: string, id: string): Promise<ItemRow | null> {
  if (!isUuid(id)) return null;
  const db = getDb();
  const item = (await db.from("activity_items").select("*").eq("id", id).maybeSingle()).data as ItemRow | null;
  if (!item) return null;
  const course = (await db.from("courses").select("academy_id").eq("id", item.course_id).maybeSingle()).data as { academy_id: string } | null;
  const academy = course ? ((await db.from("academies").select("slug").eq("id", course.academy_id).maybeSingle()).data as { slug: string } | null) : null;
  return academy?.slug === slug ? item : null;
}
const label = (i: ItemRow) => `${TYPE_LABEL[i.item_type]}: ${i.prompt.slice(0, 60)}`;

/** A Reviewer edits a Draft item. Body: { prompt?, explanation?, goal?, level?, interests?, content?, answerKey? }. The citation stays. */
export async function editItem(actor: Account, slug: string, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.activities.edit";
  const scope = courseScope(actor, "courses.review", slug);
  const item = await itemInCourse(slug, id);
  if (!item) return refused(404, "No such activity item in this course.", A);
  const target = { type: "activity_item", id, label: label(item) };
  if (scope) return refused(403, scope, A, target);
  if (item.status !== "draft") return refused(409, `Only a Draft item is edited; this one is ${item.status}.`, A, target);
  const next = {
    prompt: body.prompt === undefined ? item.prompt : clean(body.prompt, 2000),
    explanation: body.explanation === undefined ? item.explanation : clean(body.explanation, 2000),
    goal: body.goal === undefined ? item.goal : clean(body.goal, 300),
    level: body.level === undefined ? item.level : body.level,
    interests: Array.isArray(body.interests) ? body.interests.map((x) => clean(x, 40)).filter(Boolean).slice(0, 3) : item.interests,
    content: body.content && typeof body.content === "object" && !Array.isArray(body.content) ? (body.content as Content) : item.content,
    answer_key: body.answerKey === undefined ? item.answer_key : (body.answerKey as AnswerKey),
  };
  if (next.prompt.length < 3 || next.explanation.length < 3 || next.goal.length < 3) return refused(400, "An item needs a prompt, a goal and an explanation.", A, target);
  if (!(LEVELS as readonly unknown[]).includes(next.level)) return refused(400, "Choose beginner or intermediate.", A, target);
  const problem = checkItem(item.item_type, next.content, next.answer_key);
  if (problem) return refused(400, problem, A, target);
  if (ATTORNEY.test(JSON.stringify(next))) return refused(400, NO_ATTORNEY, A, target);
  const before = itemLines(item).join(" | ").slice(0, 900);
  const after = itemLines({ ...item, ...next } as ItemRow).join(" | ").slice(0, 900);
  const { error } = await getDb().from("activity_items").update({ ...next, edited_by_account_id: actor.id, edited_at: new Date().toISOString(), generated_by: "person" }).eq("id", id);
  if (error) throw new Error(`activity edit failed: ${error.message}`);
  return {
    ok: true, body: { id, status: "draft" },
    event: {
      action: A, result: "Completed", target, previous: before, next: after, context: `Edited the Draft item "${label(item)}" by hand.`,
    },
  };
}

/** A Reviewer approves or rejects a Draft item. Body: { decision: "approve" | "reject", note }. */
export async function reviewItem(actor: Account, slug: string, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.activities.review";
  const scope = courseScope(actor, "courses.review", slug);
  const item = await itemInCourse(slug, id);
  if (!item) return refused(404, "No such activity item in this course.", A);
  const target = { type: "activity_item", id, label: label(item) };
  if (scope) return refused(403, scope, A, target);
  if (body.decision !== "approve" && body.decision !== "reject") return refused(400, "Choose approve or reject.", A, target);
  const note = clean(body.note, 1000);
  if (note.length < 5) return refused(400, body.decision === "approve" ? "Say what you checked (for example: answer key and citation match the source)." : "Say what's wrong with it.", A, target);
  if (ATTORNEY.test(note)) return refused(400, NO_ATTORNEY, A, target);
  if (item.status !== "draft") return refused(409, `Only a Draft item is reviewed; this one is ${item.status}.`, A, target);
  if (body.decision === "approve") {
    const src = (await getDb().from("sources").select("status").eq("id", item.citation?.sourceId ?? "").maybeSingle()).data as { status: string } | null;
    if (src?.status !== "approved") return refused(409, "The source this item cites isn't approved (any more). Reject it, or re-approve the source.", A, target);
  }
  const status = body.decision === "approve" ? "approved" : "rejected";
  const { error } = await getDb().from("activity_items").update({ status, reviewed_by_account_id: actor.id, reviewed_at: new Date().toISOString(), review_note: note }).eq("id", id);
  if (error) throw new Error(`activity review failed: ${error.message}`);
  return {
    ok: true, body: { id, status },
    event: { action: A, result: "Completed", target, previous: "draft", next: status, context: `${status === "approved" ? "Approved" : "Rejected"} "${label(item)}": ${note}` },
  };
}

/** Publishes a module's approved items, if the module then has at least 3 different activity types. */
export async function publishModule(actor: Account, slug: string, moduleId: string): Promise<Result> {
  const A = "courses.activities.publish";
  const scope = courseScope(actor, "courses.publish", slug);
  if (!isUuid(moduleId)) return refused(404, "No such module in this course.", A);
  const db = getDb();
  const mod = (await db.from("modules").select("id, title, course_id").eq("id", moduleId).maybeSingle()).data as { id: string; title: string; course_id: string } | null;
  const course = mod ? ((await db.from("courses").select("academy_id").eq("id", mod.course_id).maybeSingle()).data as { academy_id: string } | null) : null;
  const academy = course ? ((await db.from("academies").select("slug").eq("id", course.academy_id).maybeSingle()).data as { slug: string } | null) : null;
  if (!mod || academy?.slug !== slug) return refused(404, "No such module in this course.", A);
  const target = { type: "module", id: moduleId, label: mod.title };
  if (scope) return refused(403, scope, A, target);
  const items = ((await db.from("activity_items").select("id, status, item_type, previous_item_id").eq("module_id", moduleId)).data ?? []) as ItemRow[];
  const v = moduleVariety(items);
  if (!v.approved) return refused(409, "There are no approved items in this module to publish.", A, target);
  if (!v.ok) return refused(409, `A module needs at least ${MIN_MODULE_TYPES} different activity types to be published; this one would have ${v.types}. Approve items of more types first.`, A, target);
  const { data, error } = await db.rpc("publish_module_activities", { p_module: moduleId, p_actor: actor.id });
  if (error) {
    if (/at least 3 different activity types/.test(error.message)) return refused(409, `A module needs at least ${MIN_MODULE_TYPES} different activity types to be published.`, A, target);
    if (/no longer approved/.test(error.message)) return refused(409, "A source one of these items cites is no longer approved. Reject that item first.", A, target);
    throw new Error(`activity publish failed: ${error.message}`);
  }
  return {
    ok: true, body: { moduleId, published: Number(data), types: v.types },
    event: {
      action: A, result: "Completed", target, previous: `${v.publishedTypes} type(s) published`, next: `${Number(data)} item(s) published; ${v.types} type(s) live`,
      context: `Published ${Number(data)} approved practice item(s) in "${mod.title}" (${v.types} activity types). Learners now see them; items they replace were archived.`,
    },
  };
}

/** The Owner's list of modules that fail the variety rule (have items, but fewer than 3 live types). */
export async function varietyFailures() {
  const db = getDb();
  const items = ((await db.from("activity_items").select("id, module_id, status, item_type, previous_item_id").in("status", ["draft", "approved", "published"])).data ?? []) as (ItemRow)[];
  const moduleIds = [...new Set(items.map((i) => i.module_id))];
  if (!moduleIds.length) return [];
  const mods = ((await db.from("modules").select("id, title, course_id").in("id", moduleIds)).data ?? []) as { id: string; title: string; course_id: string }[];
  const courses = ((await db.from("courses").select("id, academy_id").in("id", [...new Set(mods.map((m) => m.course_id))])).data ?? []) as { id: string; academy_id: string }[];
  const academies = ((await db.from("academies").select("id, slug, name").in("id", [...new Set(courses.map((c) => c.academy_id))])).data ?? []) as { id: string; slug: string; name: string }[];
  return mods.flatMap((m) => {
    const v = moduleVariety(items.filter((i) => i.module_id === m.id));
    const a = academies.find((x) => x.id === courses.find((c) => c.id === m.course_id)?.academy_id);
    return v.ok || !a || a.slug === OWNER_ACADEMY_SLUG ? [] : [{ moduleId: m.id, module: m.title, course: a.slug, courseName: a.name, types: v.types, min: MIN_MODULE_TYPES }];
  });
}

/** Common misses for a lesson's code-graded items: how often each wrong answer was given. Counts only, no names. */
export async function lessonMisses(actor: Account, slug: string, lessonId: string) {
  if (!canSeeCourse(actor, slug) || courseScope(actor, "courses.review", slug)) return null;
  if (!isUuid(lessonId)) return null;
  const db = getDb();
  const items = ((await db.from("activity_items").select("*").eq("lesson_id", lessonId).eq("grading", "code").in("status", ["published", "archived"])).data ?? []) as ItemRow[];
  if (items.length && !(await itemInCourse(slug, items[0].id))) return null;
  const attempts = items.length ? (((await db.from("activity_attempts").select("item_id, correct, answer").in("item_id", items.map((i) => i.id))).data ?? []) as
    { item_id: string; correct: boolean; answer: unknown }[]) : [];
  return items.map((i) => {
    const mine = attempts.filter((a) => a.item_id === i.id);
    const wrong = new Map<string, number>();
    for (const a of mine.filter((x) => !x.correct)) wrong.set(JSON.stringify(a.answer), (wrong.get(JSON.stringify(a.answer)) ?? 0) + 1);
    return {
      id: i.id, type: i.item_type, typeLabel: TYPE_LABEL[i.item_type], prompt: i.prompt, status: i.status, content: i.content, answerKey: i.answer_key,
      attempts: mine.length, correct: mine.filter((a) => a.correct).length,
      misses: [...wrong.entries()].sort((a, b) => b[1] - a[1]).map(([answer, count]) => ({ answer: JSON.parse(answer) as unknown, count })),
    };
  }).sort((a, b) => b.attempts - b.correct - (a.attempts - a.correct));
}
