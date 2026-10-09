import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ATTORNEY, NO_ATTORNEY, clean, courseScope, isUuid, refused, type Result } from "./common";
import { findIncomeClaims } from "./income";
import type { LessonBody } from "./lessons";
import { academyOf, activeBoosters } from "./owner-review";
import { MODULE_COUNT, RECOMMENDED_PACE, checkRecipe, typeFits, type ItemPart } from "./structure";
import type { ItemType } from "@/lib/activities/types";

/**
 * C1: the course editor (the Owner, and course builders on their assigned courses). Every change is to the latest
 * course version while it is a Draft, and every change is audited. A course that is live is never edited in place:
 * "Start a new version" copies it into a new Draft version (0020's new_course_version), and the edits go there; the live
 * version stays as learners see it until the new one is reviewed, approved by the Owner and published.
 *
 * Lesson text is edited in its open Draft lesson version (a version in Review goes back to Draft first: the Owner sends
 * the module back, or a Reviewer returns it). Practice items are edited while Draft (lib/activities/review.ts editItem);
 * a published one is revised as a new Draft that replaces it when published.
 */

type CourseRow = { id: string; academy_id: string; version: number; status: string; owner_review_required: boolean };
type ModuleRow = { id: string; course_id: string; position: number; code: string; title: string; stage: string | null; recipe: Record<string, unknown>; recommended_pace: string };

const reason = (msg: string) => msg.replace(/^ASCENTRA: /, "");
const incomeProblem = (text: string) => {
  const f = findIncomeClaims(text)[0];
  return f ? `This reads as ${f.claim}: "${f.text}". ASCENTRA never promises income or results. Reword it.` : null;
};

/** The latest version of a course and whether it can be edited. */
async function draftCourse(actor: Account, slug: string, A: string): Promise<{ course: CourseRow; name: string } | Result<never>> {
  const scope = courseScope(actor, "courses.edit", slug);
  const academy = await academyOf(slug);
  if (!academy) return refused(404, "No such course.", A);
  if (scope) return refused(403, scope, A, { type: "course", id: slug, label: academy.name });
  const course = (((await getDb().from("courses").select("id, academy_id, version, status, owner_review_required").eq("academy_id", academy.id)).data ?? []) as CourseRow[])
    .sort((a, b) => b.version - a.version)[0];
  if (!course) return refused(404, "This course has no version yet. Approve a Blueprint first.", A, { type: "course", id: slug, label: academy.name });
  if (course.status !== "draft") return refused(409, `Version ${course.version} is live. Start a new version to edit it; learners keep seeing the live one until the new version is published.`, A, { type: "course", id: slug, label: academy.name });
  return { course, name: academy.name };
}
const isRefusal = (x: unknown): x is Result<never> => !!x && typeof x === "object" && "ok" in x;

async function moduleOf(courseId: string, moduleId: string): Promise<ModuleRow | null> {
  if (!isUuid(moduleId)) return null;
  const m = (await getDb().from("modules").select("id, course_id, position, code, title, stage, recipe, recommended_pace").eq("id", moduleId).maybeSingle()).data as ModuleRow | null;
  return m && m.course_id === courseId ? m : null;
}

/** Starts a new Draft version of a live course: everything copied, practice and lessons as Drafts, videos kept. */
export async function newVersion(actor: Account, slug: string): Promise<Result> {
  const A = "courses.version.new";
  const scope = courseScope(actor, "courses.edit", slug);
  const academy = await academyOf(slug);
  if (!academy) return refused(404, "No such course.", A);
  const target = { type: "course", id: slug, label: academy.name };
  if (scope) return refused(403, scope, A, target);
  const { data, error } = await getDb().rpc("new_course_version", { p_academy: academy.id, p_actor: actor.id });
  if (error) {
    if (/ASCENTRA/.test(error.message)) return refused(409, reason(error.message), A, target);
    throw new Error(`new version failed: ${error.message}`);
  }
  const v = (await getDb().from("courses").select("version").eq("id", data as string).single()).data as { version: number };
  return {
    ok: true, status: 201, body: { courseId: data, version: v.version },
    event: { action: A, result: "Completed", target, previous: `v${v.version - 1} live`, next: `v${v.version} Draft`, context: `Started Draft version ${v.version} of "${academy.name}" from version ${v.version - 1}. It needs the Owner's approval, module by module, before it is published.` },
  };
}

/** Body: any of { title, stage, recipe, pace }. */
export async function updateModule(actor: Account, slug: string, moduleId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.module.edit";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const m = await moduleOf(dc.course.id, moduleId);
  if (!m) return refused(404, "No such module in this course version.", A);
  const target = { type: "module", id: m.id, label: `${slug} v${dc.course.version}: ${m.title}` };
  const next: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = clean(body.title, 200);
    if (t.length < 3) return refused(400, "A module title needs at least 3 characters.", A, target);
    next.title = t;
  }
  if (body.stage !== undefined) next.stage = clean(body.stage, 60) || null;
  if (body.pace !== undefined) next.recommended_pace = clean(body.pace, 60) || RECOMMENDED_PACE;
  if (body.recipe !== undefined) {
    const r = checkRecipe(body.recipe, (await activeBoosters()).map((b) => b.key));
    if ("problem" in r) return refused(400, r.problem, A, target);
    next.recipe = r.recipe;
  }
  if (!Object.keys(next).length) return refused(400, "Nothing to change.", A, target);
  const text = [next.title, next.stage, next.recommended_pace].filter((x): x is string => typeof x === "string").join(" \n ");
  if (ATTORNEY.test(text)) return refused(400, NO_ATTORNEY, A, target);
  const income = incomeProblem(text);
  if (income) return refused(400, income, A, target);
  const { error } = await getDb().from("modules").update(next).eq("id", m.id);
  if (error) throw new Error(`module edit failed: ${error.message}`);
  const before = { title: m.title, stage: m.stage, recipe: m.recipe, pace: m.recommended_pace };
  return {
    ok: true, body: { id: m.id, ...next },
    event: { action: A, result: "Completed", target, previous: JSON.stringify(before).slice(0, 900), next: JSON.stringify(next).slice(0, 900), context: `Edited module ${m.position} of "${dc.name}" v${dc.course.version}: ${Object.keys(next).join(", ")}.` },
  };
}

/** Body: { ids: [every module id, in the new order] }. */
export async function reorderModules(actor: Account, slug: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.module.reorder";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid) : [];
  const target = { type: "course", id: slug, label: `${dc.name} v${dc.course.version}` };
  if (!ids.length) return refused(400, "Send the modules in their new order.", A, target);
  const before = (((await getDb().from("modules").select("id, title, position").eq("course_id", dc.course.id)).data ?? []) as { id: string; title: string; position: number }[]).sort((a, b) => a.position - b.position);
  const { error } = await getDb().rpc("reorder_modules", { p_course: dc.course.id, p_ids: ids });
  if (error) {
    if (/ASCENTRA/.test(error.message)) return refused(409, reason(error.message), A, target);
    throw new Error(`reorder failed: ${error.message}`);
  }
  const title = (id: string) => before.find((b) => b.id === id)?.title ?? id;
  return {
    ok: true, body: { ids },
    event: { action: A, result: "Completed", target, previous: before.map((b) => b.title).join(" → ").slice(0, 900), next: ids.map(title).join(" → ").slice(0, 900), context: `Reordered the modules of "${dc.name}" v${dc.course.version}.` },
  };
}

/** Body: { ids: [every lesson id of the module, in the new order] }. */
export async function reorderLessons(actor: Account, slug: string, moduleId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.lesson.reorder";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const m = await moduleOf(dc.course.id, moduleId);
  if (!m) return refused(404, "No such module in this course version.", A);
  const target = { type: "module", id: m.id, label: `${slug} v${dc.course.version}: ${m.title}` };
  const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid) : [];
  if (!ids.length) return refused(400, "Send the lessons in their new order.", A, target);
  const before = (((await getDb().from("lessons").select("id, title, position").eq("module_id", m.id)).data ?? []) as { id: string; title: string; position: number }[]).sort((a, b) => a.position - b.position);
  const { error } = await getDb().rpc("reorder_lessons", { p_module: m.id, p_ids: ids });
  if (error) {
    if (/ASCENTRA/.test(error.message)) return refused(409, reason(error.message), A, target);
    throw new Error(`reorder failed: ${error.message}`);
  }
  const title = (id: string) => before.find((b) => b.id === id)?.title ?? id;
  return {
    ok: true, body: { ids },
    event: { action: A, result: "Completed", target, previous: before.map((b) => b.title).join(" → ").slice(0, 900), next: ids.map(title).join(" → ").slice(0, 900), context: `Reordered the lessons of module ${m.position} "${m.title}".` },
  };
}

/** Body: { title }. A course has 5 or 6 modules: a sixth is added at the end. */
export async function addModule(actor: Account, slug: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.module.add";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const target = { type: "course", id: slug, label: `${dc.name} v${dc.course.version}` };
  const title = clean(body.title, 200);
  if (title.length < 3) return refused(400, "A module title needs at least 3 characters.", A, target);
  if (ATTORNEY.test(title)) return refused(400, NO_ATTORNEY, A, target);
  const income = incomeProblem(title);
  if (income) return refused(400, income, A, target);
  const mods = ((await getDb().from("modules").select("id, position, recipe").eq("course_id", dc.course.id)).data ?? []) as { id: string; position: number; recipe: Record<string, unknown> }[];
  if (dc.course.owner_review_required && mods.length >= MODULE_COUNT.max) return refused(409, `A course has ${MODULE_COUNT.min} or ${MODULE_COUNT.max} modules; this one already has ${mods.length}.`, A, target);
  const position = Math.max(0, ...mods.map((x) => x.position)) + 1;
  const last = mods.sort((a, b) => b.position - a.position)[0];
  const { data, error } = await getDb().from("modules").insert({
    course_id: dc.course.id, position, code: `m${position}-${crypto.randomUUID().slice(0, 6)}`, title, recipe: last?.recipe ?? {}, recommended_pace: RECOMMENDED_PACE,
  }).select("id").single();
  if (error) throw new Error(`module add failed: ${error.message}`);
  const id = (data as { id: string }).id;
  return {
    ok: true, status: 201, body: { id, position },
    event: { action: A, result: "Completed", target, previous: `${mods.length} modules`, next: `${mods.length + 1} modules`, context: `Added module ${position} "${title}" to "${dc.name}" v${dc.course.version}.` },
  };
}

/** Removes a module that has nothing in it yet (no lesson text, no practice, no uploaded video), keeping at least 5. */
export async function removeModule(actor: Account, slug: string, moduleId: string): Promise<Result> {
  const A = "courses.module.remove";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const m = await moduleOf(dc.course.id, moduleId);
  if (!m) return refused(404, "No such module in this course version.", A);
  const target = { type: "module", id: m.id, label: `${slug} v${dc.course.version}: ${m.title}` };
  const db = getDb();
  const count = ((await db.from("modules").select("id").eq("course_id", dc.course.id)).data ?? []).length;
  if (dc.course.owner_review_required && count <= MODULE_COUNT.min) return refused(409, `A course has ${MODULE_COUNT.min} or ${MODULE_COUNT.max} modules; this one can't go below ${MODULE_COUNT.min}.`, A, target);
  const lessons = ((await db.from("lessons").select("id").eq("module_id", m.id)).data ?? []) as { id: string }[];
  const versions = lessons.length ? ((await db.from("lesson_versions").select("id").in("lesson_id", lessons.map((l) => l.id))).data ?? []).length : 0;
  const items = ((await db.from("activity_items").select("id").eq("module_id", m.id)).data ?? []).length;
  const slots = ((await db.from("video_slots").select("id").eq("module_id", m.id)).data ?? []) as { id: string }[];
  const uploads = slots.length ? ((await db.from("video_uploads").select("id").in("slot_id", slots.map((s) => s.id))).data ?? []).length : 0;
  const reviews = ((await db.from("module_reviews").select("id").eq("module_id", m.id)).data ?? []).length;
  if (versions || items || uploads || reviews) return refused(409, "This module already has lesson text, practice, videos or a review. It's kept; rename or reorder it instead.", A, target);
  await db.from("skills").update({ module_id: null }).eq("module_id", m.id);
  const { error } = await db.from("modules").delete().eq("id", m.id);
  if (error) throw new Error(`module remove failed: ${error.message}`);
  // Close the gap so positions stay 1..n.
  const rest = (((await db.from("modules").select("id, position").eq("course_id", dc.course.id)).data ?? []) as { id: string; position: number }[]).sort((a, b) => a.position - b.position);
  if (rest.length) await db.rpc("reorder_modules", { p_course: dc.course.id, p_ids: rest.map((r) => r.id) });
  return {
    ok: true, body: { removed: m.id },
    event: { action: A, result: "Completed", target, previous: `${count} modules`, next: `${count - 1} modules`, context: `Removed the empty module ${m.position} "${m.title}" from "${dc.name}" v${dc.course.version}.` },
  };
}

/** Body: { title }. Adds a lesson at the end of a module. */
export async function addLesson(actor: Account, slug: string, moduleId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.lesson.add";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const m = await moduleOf(dc.course.id, moduleId);
  if (!m) return refused(404, "No such module in this course version.", A);
  const target = { type: "module", id: m.id, label: `${slug} v${dc.course.version}: ${m.title}` };
  const title = clean(body.title, 200);
  if (title.length < 3) return refused(400, "A lesson title needs at least 3 characters.", A, target);
  if (ATTORNEY.test(title)) return refused(400, NO_ATTORNEY, A, target);
  const income = incomeProblem(title);
  if (income) return refused(400, income, A, target);
  const lessons = ((await getDb().from("lessons").select("position").eq("module_id", m.id)).data ?? []) as { position: number }[];
  if (lessons.length >= 12) return refused(409, "A module has at most 12 lessons.", A, target);
  const position = Math.max(0, ...lessons.map((x) => x.position)) + 1;
  const { data, error } = await getDb().from("lessons").insert({ module_id: m.id, position, title, minutes: 10 }).select("id").single();
  if (error) throw new Error(`lesson add failed: ${error.message}`);
  return {
    ok: true, status: 201, body: { id: (data as { id: string }).id, position },
    event: { action: A, result: "Completed", target, previous: `${lessons.length} lessons`, next: `${lessons.length + 1} lessons`, context: `Added lesson "${title}" to module ${m.position} "${m.title}".` },
  };
}

type Version = { id: string; lesson_id: string; version: number; status: string; title: string; body: LessonBody };

/**
 * Body: { title?, summary?, headings?: { [section]: text }, paragraphs?: { "s.p": text }, takeaways?: { [i]: text } }.
 * Edits the lesson's open Draft version in place, keeping each paragraph's citations; a lesson with no version yet gets
 * its first one, written by a person. Text a Reviewer already verified needs verifying again: it goes back through Review.
 */
export async function editLessonText(actor: Account, slug: string, lessonId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.lesson.edit";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  if (!isUuid(lessonId)) return refused(404, "No such lesson in this course version.", A);
  const db = getDb();
  const lesson = (await db.from("lessons").select("id, module_id, title").eq("id", lessonId).maybeSingle()).data as { id: string; module_id: string; title: string } | null;
  if (!lesson || !(await moduleOf(dc.course.id, lesson.module_id))) return refused(404, "No such lesson in this course version.", A);
  const target = { type: "lesson", id: lesson.id, label: `${slug} v${dc.course.version}: ${lesson.title}` };
  const versions = ((await db.from("lesson_versions").select("id, lesson_id, version, status, title, body").eq("lesson_id", lesson.id)).data ?? []) as Version[];
  const open = versions.find((v) => v.status === "review");
  if (open) return refused(409, `Version ${open.version} is in Review. It goes back to Draft first (the Owner sends the module back, or a Reviewer returns it), then it can be edited.`, A, target);
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const base: LessonBody = draft?.body ?? { summary: "", sections: [], takeaways: [] };
  const next: LessonBody = JSON.parse(JSON.stringify(base));
  const changed: string[] = [];
  const text = (v: unknown, max: number) => clean(v, max);
  let title = draft?.title ?? lesson.title;
  if (body.title !== undefined) {
    const t = text(body.title, 300);
    if (t.length < 3) return refused(400, "A lesson title needs at least 3 characters.", A, target);
    title = t;
    changed.push("title");
  }
  if (body.summary !== undefined) { next.summary = text(body.summary, 600); changed.push("summary"); }
  // Highest index first: removing an empty paragraph never shifts one still to be changed, and an added one goes at the end.
  const rank = (k: string) => k.split(".").reduce((n, x) => n * 100 + Number(x), 0);
  const entries = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>).sort((a, b) => rank(b[0]) - rank(a[0])) : []);
  for (const [k, v] of entries(body.headings)) {
    const si = Number(k);
    const t = text(v, 200);
    if (!Number.isInteger(si) || si < 0 || si > next.sections.length || si > 7) return refused(400, `There's no section ${si + 1}.`, A, target);
    if (si === next.sections.length) next.sections.push({ heading: t, paragraphs: [] });
    else next.sections[si].heading = t;
    changed.push(`section ${si + 1} heading`);
  }
  for (const [k, v] of entries(body.paragraphs)) {
    const [si, pi] = k.split(".").map(Number);
    const sec = next.sections[si];
    if (!sec || !Number.isInteger(pi) || pi < 0 || pi > sec.paragraphs.length || pi > 5) return refused(400, `There's no paragraph ${k}.`, A, target);
    const t = text(v, 2000);
    if (pi === sec.paragraphs.length) { if (t) sec.paragraphs.push({ text: t, refs: [] }); }
    else if (!t) sec.paragraphs.splice(pi, 1);
    else sec.paragraphs[pi] = { ...sec.paragraphs[pi], text: t };
    changed.push(`section ${si + 1} paragraph ${pi + 1}`);
  }
  for (const [k, v] of entries(body.takeaways)) {
    const ti = Number(k);
    if (!Number.isInteger(ti) || ti < 0 || ti > next.takeaways.length || ti > 5) return refused(400, `There's no takeaway ${ti + 1}.`, A, target);
    const t = text(v, 2000);
    if (ti === next.takeaways.length) { if (t) next.takeaways.push({ text: t, refs: [] }); }
    else if (!t) next.takeaways.splice(ti, 1);
    else next.takeaways[ti] = { ...next.takeaways[ti], text: t };
    changed.push(`takeaway ${ti + 1}`);
  }
  next.sections = next.sections.filter((s) => s.heading);
  if (!changed.length) return refused(400, "Nothing to change.", A, target);
  const all = [title, next.summary, ...next.sections.flatMap((s) => [s.heading, ...s.paragraphs.map((p) => p.text)]), ...next.takeaways.map((t) => t.text)].join(" \n ");
  if (ATTORNEY.test(all)) return refused(400, NO_ATTORNEY, A, target);
  const income = incomeProblem(all);
  if (income) return refused(400, income, A, target);
  const uncited = [...next.sections.flatMap((s) => s.paragraphs), ...next.takeaways].filter((p) => !p.refs.length).length;
  if (draft) {
    const { error } = await db.from("lesson_versions").update({ title, body: next, uncited_count: uncited, generated_by: "person", returned_note: null }).eq("id", draft.id);
    if (error) {
      if (/ASCENTRA/.test(error.message)) return refused(409, reason(error.message), A, target);
      throw new Error(`lesson edit failed: ${error.message}`);
    }
  } else {
    const nextNo = Math.max(0, ...versions.map((v) => v.version)) + 1;
    const { error } = await db.from("lesson_versions").insert({
      lesson_id: lesson.id, course_id: dc.course.id, version: nextNo, status: "draft", title, body: next, citations: [], uncited_count: uncited, generated_by: "person", created_by_account_id: actor.id,
    });
    if (error) {
      if (/ASCENTRA/.test(error.message)) return refused(409, reason(error.message), A, target);
      throw new Error(`lesson edit failed: ${error.message}`);
    }
  }
  if (body.title !== undefined && title !== lesson.title) await db.from("lessons").update({ title }).eq("id", lesson.id);
  return {
    ok: true, body: { lessonId: lesson.id, changed, uncited },
    event: { action: A, result: "Completed", target, previous: draft ? `v${draft.version} Draft` : "no version", next: draft ? `v${draft.version} Draft (edited)` : "a new Draft written by a person", context: `Edited "${title}": ${changed.join(", ").slice(0, 600)}.` },
  };
}

type ItemRow = {
  id: string; lesson_id: string; module_id: string; course_id: string; idea_key: string; version: number; status: string; item_type: ItemType; grading: string; level: string; goal: string;
  interests: string[]; prompt: string; content: unknown; answer_key: unknown; explanation: string; citation: unknown; recipe_part: string | null; booster_key: string | null;
};
async function itemOf(courseId: string, id: string): Promise<ItemRow | null> {
  if (!isUuid(id)) return null;
  const i = (await getDb().from("activity_items").select("*").eq("id", id).maybeSingle()).data as ItemRow | null;
  return i && i.course_id === courseId ? i : null;
}

/** Body: { part: quiz | assignment | sandbox | sequence | booster, booster? }. Only a Draft item's place in the recipe changes. */
export async function setItemPart(actor: Account, slug: string, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.activities.part";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const item = await itemOf(dc.course.id, id);
  if (!item) return refused(404, "No such practice item in this course version.", A);
  const target = { type: "activity_item", id, label: item.prompt.slice(0, 80) };
  if (item.status !== "draft") return refused(409, `Only a Draft item moves to another part of the recipe; this one is ${item.status}.`, A, target);
  const part = body.part as ItemPart;
  if (!["quiz", "assignment", "sandbox", "sequence", "booster"].includes(part)) return refused(400, "Choose quiz, assignment, sandbox, interactive sequence or a learning booster.", A, target);
  let boosterKey: string | null = null;
  let boosterTypes: string[] = [];
  if (part === "booster") {
    const b = (await activeBoosters()).find((x) => x.key === body.booster);
    if (!b) return refused(400, "Choose a learning booster from the list.", A, target);
    boosterKey = b.key;
    boosterTypes = b.itemTypes;
  }
  if (!typeFits(item.item_type, part, boosterTypes)) return refused(400, "This kind of item doesn't fit that part of the recipe.", A, target);
  const { error } = await getDb().from("activity_items").update({ recipe_part: part, booster_key: boosterKey }).eq("id", id);
  if (error) throw new Error(`item part failed: ${error.message}`);
  return {
    ok: true, body: { id, part, booster: boosterKey },
    event: { action: A, result: "Completed", target, previous: item.recipe_part ?? "not set", next: boosterKey ? `booster: ${boosterKey}` : part, context: `Moved a practice item to ${boosterKey ? `the "${boosterKey}" booster` : `the ${part} part`} of its module's recipe.` },
  };
}

/**
 * An approved (not yet published) item in a Draft course version goes back to Draft for editing: a Draft copy takes
 * its place and it needs reviewing again. The approval it had is in the audit log. A published item is never changed;
 * "Start a new version" makes Draft copies of those.
 */
export async function reopenItem(actor: Account, slug: string, id: string): Promise<Result> {
  const A = "courses.activities.reopen";
  const dc = await draftCourse(actor, slug, A);
  if (isRefusal(dc)) return dc;
  const item = await itemOf(dc.course.id, id);
  if (!item) return refused(404, "No such practice item in this course version.", A);
  const target = { type: "activity_item", id, label: item.prompt.slice(0, 80) };
  if (item.status !== "approved" && item.status !== "rejected") return refused(409, `Only an approved or rejected item is reopened; this one is ${item.status}.`, A, target);
  const db = getDb();
  const { data, error } = await db.from("activity_items").insert({
    lesson_id: item.lesson_id, module_id: item.module_id, course_id: item.course_id, idea_key: item.idea_key, version: item.version + 1, status: "draft",
    item_type: item.item_type, grading: item.grading, level: item.level, goal: item.goal, interests: item.interests, prompt: item.prompt, content: item.content,
    answer_key: item.answer_key, explanation: item.explanation, citation: item.citation, generated_by: "person", created_by_account_id: actor.id,
    recipe_part: item.recipe_part, booster_key: item.booster_key,
  }).select("id").single();
  if (error) throw new Error(`item reopen failed: ${error.message}`);
  await db.from("activity_items").update({ previous_item_id: null }).eq("previous_item_id", id);
  const del = await db.from("activity_items").delete().eq("id", id);
  if (del.error) throw new Error(`item reopen failed: ${del.error.message}`);
  const newId = (data as { id: string }).id;
  return {
    ok: true, status: 201, body: { id: newId, status: "draft" },
    event: { action: A, result: "Completed", target, previous: item.status, next: "draft (needs review again)", context: `Reopened a ${item.status} practice item for editing as a new Draft (${newId}); it needs reviewing again.` },
  };
}
