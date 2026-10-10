import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canSeeCourse, clean, isUuid, refused, type Result } from "./common";
import type { LessonBody } from "./lessons";
import { INCOME_BLOCK, scanTexts, textsOf, type Finding } from "./income";
import { RECOMMENDED_PACE, briefText, checkModuleCount, coverage, defaultPartOf, isSizeTier, type Coverage, type Recipe, type SizeTier, type VideoBrief } from "./structure";
import type { ItemType } from "@/lib/activities/types";

/**
 * C1: the course studio. What the Owner editor, the video slots and the Owner's review all read: the course's latest
 * version, module by module (recipe and how far it is met, lessons and their versions, practice items by part, video
 * slots), the income-claims check, and each module's Owner decision. Then the Owner's review itself (approve, or send
 * back with a note), and publishing or unpublishing the course.
 *
 * The rules are the database's (0020): a lesson version or activity item of a course that needs the Owner's review is
 * published only when the module's latest decision approves exactly that version; the course goes live only when every
 * module is approved. This file explains them in plain words before the database would refuse.
 */

type CourseRow = {
  id: string; academy_id: string; version: number; status: string; owner_review_required: boolean; unpublished_at: string | null; published_at: string | null;
  size_tier?: string | null; license_notice?: string | null; software_notice?: string | null;
};
type ModuleRow = { id: string; course_id: string; position: number; title: string; stage: string | null; recipe: Partial<Recipe>; recommended_pace: string };
type LessonRow = { id: string; module_id: string; position: number; title: string; minutes: number | null };
type VersionRow = {
  id: string; lesson_id: string; version: number; status: string; title: string; body: LessonBody; submitted_at: string | null; verified_at: string | null;
  verified_by_account_id: string | null; returned_note: string | null; published_at: string | null;
};
type ItemRow = { id: string; lesson_id: string; module_id: string; status: string; item_type: ItemType; recipe_part: string | null; booster_key: string | null; prompt: string; content: unknown; explanation: string; reviewed_at: string | null;
  importance?: string | null; notebook_note?: string | null; mission_type?: string | null };
type SlotRow = {
  id: string; module_id: string; lesson_id: string | null; position: number; title: string; brief: VideoBrief; brief_generated_by: string; status: string;
  current_upload_id: string | null; transcript: string | null; approved_at: string | null; approved_by_account_id: string | null; brief_edited_at: string | null;
  importance?: string | null; notebook_note?: string | null;
};
type UploadRow = { id: string; slot_id: string; storage_path: string; mime: string; size_bytes: number; status: string; reject_reason: string | null; original_name: string | null; uploaded_by_account_id: string; uploaded_at: string; replaced_at: string | null };
type ReviewRow = { id: string; seq: number; module_id: string; decision: "approved" | "sent_back"; note: string | null; lesson_version_ids: string[]; item_ids: string[]; decided_by_account_id: string; decided_at: string };

export type Academy = { id: string; slug: string; name: string };

export async function academyOf(slug: string): Promise<Academy | null> {
  return (await getDb().from("academies").select("id, slug, name").eq("slug", slug).maybeSingle()).data as Academy | null;
}
async function coursesOf(academyId: string): Promise<CourseRow[]> {
  return (((await getDb().from("courses").select("*").eq("academy_id", academyId)).data ?? []) as CourseRow[])
    .sort((a, b) => b.version - a.version);
}
const isLive = (c: CourseRow) => c.status === "published" || c.status === "restored";

/** Everything about one course version that the studio and the review need, in one read. */
export async function loadVersion(courseId: string) {
  const db = getDb();
  const modules = ((await db.from("modules").select("id, course_id, position, title, stage, recipe, recommended_pace").eq("course_id", courseId)).data ?? []) as ModuleRow[];
  modules.sort((a, b) => a.position - b.position);
  const mids = modules.map((m) => m.id);
  const none = ["00000000-0000-4000-8000-000000000000"];
  const lessons = (((await db.from("lessons").select("id, module_id, position, title, minutes").in("module_id", mids.length ? mids : none)).data ?? []) as LessonRow[]).sort((a, b) => a.position - b.position);
  const lids = lessons.map((l) => l.id);
  const versions = ((await db.from("lesson_versions").select("id, lesson_id, version, status, title, body, submitted_at, verified_at, verified_by_account_id, returned_note, published_at").in("lesson_id", lids.length ? lids : none)).data ?? []) as VersionRow[];
  const items = ((await db.from("activity_items").select("id, lesson_id, module_id, status, item_type, recipe_part, booster_key, prompt, content, explanation, reviewed_at, importance, notebook_note, mission_type").in("module_id", mids.length ? mids : none)).data ?? []) as ItemRow[];
  const slots = (((await db.from("video_slots").select("*").in("module_id", mids.length ? mids : none)).data ?? []) as SlotRow[]).sort((a, b) => a.position - b.position);
  const sids = slots.map((s) => s.id);
  const uploads = (((await db.from("video_uploads").select("*").in("slot_id", sids.length ? sids : none)).data ?? []) as UploadRow[]).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const reviews = (((await db.from("module_reviews").select("*").in("module_id", mids.length ? mids : none)).data ?? []) as ReviewRow[]).sort((a, b) => b.seq - a.seq);
  return { modules, lessons, versions, items, slots, uploads, reviews };
}
export type Loaded = Awaited<ReturnType<typeof loadVersion>>;

/** The version of a lesson the Owner would approve: a Reviewer-verified one in Review, else the published one. */
export function candidateOf(versions: VersionRow[], lessonId: string): VersionRow | null {
  const vs = versions.filter((v) => v.lesson_id === lessonId);
  return vs.find((v) => v.status === "review" && v.verified_by_account_id) ?? vs.find((v) => v.status === "published") ?? null;
}
const live = (i: ItemRow) => i.status === "approved" || i.status === "published";

/** The income-claims check over everything in a course version a learner could read, with where each finding is. */
export function incomeFindings(l: Loaded): Finding[] {
  const pieces: { where: string; text: string | null }[] = [];
  for (const m of l.modules) {
    const at = `Module ${m.position} "${m.title}"`;
    pieces.push({ where: `${at} › title`, text: m.title });
    for (const lesson of l.lessons.filter((x) => x.module_id === m.id)) {
      const lat = `${at} › lesson "${lesson.title}"`;
      pieces.push({ where: `${lat} › title`, text: lesson.title });
      for (const v of l.versions.filter((x) => x.lesson_id === lesson.id && x.status !== "archived")) {
        const b = v.body;
        pieces.push({ where: `${lat} v${v.version} › summary`, text: b?.summary ?? null });
        (b?.sections ?? []).forEach((s, si) => {
          pieces.push({ where: `${lat} v${v.version} › section ${si + 1} heading`, text: s.heading });
          s.paragraphs.forEach((p, pi) => pieces.push({ where: `${lat} v${v.version} › section ${si + 1} "${s.heading}" › paragraph ${pi + 1}`, text: p.text }));
        });
        (b?.takeaways ?? []).forEach((t, ti) => pieces.push({ where: `${lat} v${v.version} › takeaway ${ti + 1}`, text: t.text }));
      }
    }
    for (const i of l.items.filter((x) => x.module_id === m.id && x.status !== "archived" && x.status !== "rejected")) {
      pieces.push({ where: `${at} › practice item "${i.prompt.slice(0, 50)}"`, text: [i.prompt, i.explanation, ...textsOf(i.content), i.notebook_note ?? ""].join(" \n ") });
    }
    for (const s of l.slots.filter((x) => x.module_id === m.id)) {
      pieces.push({ where: `${at} › video "${s.title}" › brief`, text: [s.title, ...textsOf(s.brief)].join(" \n ") });
      if (s.transcript) pieces.push({ where: `${at} › video "${s.title}" › transcript`, text: s.transcript });
      if (s.notebook_note) pieces.push({ where: `${at} › video "${s.title}" › Notebook note`, text: s.notebook_note });
    }
  }
  return scanTexts(pieces);
}

export type ModuleState = {
  coverage: Coverage; findings: Finding[]; blockers: string[]; ready: boolean;
  candidates: string[]; itemIds: string[];
  review: { decision: "approved" | "sent_back"; note: string | null; decidedAt: string; current: boolean } | null;
};

/** Where a module stands for the Owner's review: what is missing, what would be approved, and the last decision. */
export function moduleState(l: Loaded, m: ModuleRow, findings: Finding[], labelsRequired = false): ModuleState {
  const lessons = l.lessons.filter((x) => x.module_id === m.id);
  const items = l.items.filter((i) => i.module_id === m.id && live(i));
  const slots = l.slots.filter((s) => s.module_id === m.id);
  const cov = coverage(m.recipe, slots.length, items);
  const mine = findings.filter((f) => f.where.startsWith(`Module ${m.position} "`));
  const blockers: string[] = [];
  const candidates: VersionRow[] = [];
  for (const lesson of lessons) {
    const c = candidateOf(l.versions, lesson.id);
    if (c) candidates.push(c);
    else {
      const open = l.versions.find((v) => v.lesson_id === lesson.id && (v.status === "draft" || v.status === "review"));
      blockers.push(`Lesson "${lesson.title}": ${!open ? "not drafted yet" : open.status === "draft" ? "a Draft, not submitted for review yet" : "waiting for a Reviewer's verification"}.`);
    }
  }
  if (!lessons.length) blockers.push("This module has no lessons.");
  for (const p of cov.missing) blockers.push(p === "videos" ? "No video slot." : `No reviewed ${p === "quizzes" ? "quiz" : p === "assignments" ? "assignment" : p === "sandboxes" ? "sandbox" : "interactive sequence"} item yet.`);
  if (!cov.varietyOk) blockers.push(`Practice needs at least 3 different activity types (it has ${cov.types}).`);
  if (mine.length) blockers.push(`The income-claims check found ${mine.length} place(s) to reword.`);
  // C2: every video and practice item carries its importance label; "Very important" ones their Notebook note.
  const labelled = (x: { importance?: string | null; notebook_note?: string | null }) => !!x.importance && (x.importance !== "very_important" || !!x.notebook_note);
  const unlabelled = slots.filter((x) => !labelled(x)).length + l.items.filter((i) => i.module_id === m.id && ["draft", "approved", "published"].includes(i.status) && !labelled(i)).length;
  if (labelsRequired && unlabelled) blockers.push(`${unlabelled} video(s) or practice item(s) need an importance label (and "Very important" ones a Notebook note).`);
  const latest = l.reviews.find((r) => r.module_id === m.id) ?? null;
  const ids = candidates.map((c) => c.id);
  // The approval must be newer than every candidate's last submission and verification.
  const after = candidates.flatMap((c) => [c.submitted_at, c.verified_at]).filter((x): x is string => !!x).sort().at(-1) ?? "";
  const current = !!latest && latest.decision === "approved" && ids.length === latest.lesson_version_ids.length && ids.every((id) => latest.lesson_version_ids.includes(id))
    && items.every((i) => latest.item_ids.includes(i.id)) && latest.decided_at >= after;
  return {
    coverage: cov, findings: mine, blockers, ready: !blockers.length, candidates: ids, itemIds: items.map((i) => i.id),
    review: latest ? { decision: latest.decision, note: latest.note, decidedAt: latest.decided_at, current } : null,
  };
}

/** The studio view of a course: its latest version, module by module. Null when the account can't see the course. */
export async function courseStudio(actor: Account, slug: string) {
  if (!canSeeCourse(actor, slug)) return null;
  const academy = await academyOf(slug);
  if (!academy) return null;
  const courses = await coursesOf(academy.id);
  const latest = courses[0] ?? null;
  const liveVersion = courses.find(isLive) ?? null;
  if (!latest) return { course: academy, version: null, live: null, modules: [], findings: [], emptySlots: 0, boosters: await activeBoosters(), canPublish: false, publishBlockers: ["No course version yet: approve a Blueprint first."] };
  const l = await loadVersion(latest.id);
  // C2: a course with a size tier also checks its capstone and notices, and needs every item labelled.
  const sized = isSizeTier(latest.size_tier);
  const extra = sized ? await courseExtras(latest, academy.slug) : null;
  const findings = [...incomeFindings(l), ...(extra?.findings ?? [])];
  const boosters = await activeBoosters();
  const modules = l.modules.map((m) => {
    const st = moduleState(l, m, findings, sized);
    return {
      id: m.id, position: m.position, title: m.title, stage: m.stage, recipe: { ...m.recipe }, recommendedPace: m.recommended_pace || RECOMMENDED_PACE,
      state: st,
      lessons: l.lessons.filter((x) => x.module_id === m.id).map((x) => {
        const vs = l.versions.filter((v) => v.lesson_id === x.id).sort((a, b) => a.version - b.version);
        const open = vs.find((v) => v.status === "draft" || v.status === "review") ?? null;
        const pub = vs.find((v) => v.status === "published") ?? null;
        const editable = open?.status === "draft" ? open : !open ? pub : null;
        return {
          id: x.id, position: x.position, title: x.title, minutes: x.minutes,
          open: open ? { id: open.id, version: open.version, status: open.status, verified: !!open.verified_by_account_id, returnedNote: open.returned_note } : null,
          published: pub ? { id: pub.id, version: pub.version } : null,
          // The text the editor shows: an open Draft (edited in place), else the published version (an edit makes a new Draft).
          text: editable ? { versionId: editable.id, version: editable.version, status: editable.status, body: editable.body } : null,
        };
      }),
      items: l.items.filter((i) => i.module_id === m.id && i.status !== "archived").map((i) => ({
        id: i.id, lessonId: i.lesson_id, type: i.item_type, part: i.recipe_part ?? defaultPartOf(i.item_type), partSet: !!i.recipe_part, booster: i.booster_key, status: i.status,
        prompt: i.prompt, importance: i.importance ?? null, notebookNote: i.notebook_note ?? null, missionType: i.mission_type ?? null,
      })),
      slots: l.slots.filter((s) => s.module_id === m.id).map((s) => slotView(s, l.uploads)),
    };
  });
  const emptySlots = l.slots.filter((s) => s.status !== "approved").length;
  const publishBlockers: string[] = [];
  if (latest.owner_review_required) {
    const count = checkModuleCount(l.modules.length, sized ? (latest.size_tier as SizeTier) : null);
    if (count) publishBlockers.push(count);
    if (extra && !extra.capstone) publishBlockers.push("Add the course's capstone (every course has one).");
    if (extra?.capstone && extra.business && !extra.capstone.automation) publishBlockers.push("A business course's capstone needs its \"Automation with AI\" part.");
    for (const m of modules) if (!m.state.review?.current) publishBlockers.push(`Module ${m.position} "${m.title}" needs the Owner's approval${m.state.review?.decision === "sent_back" ? " (it was sent back)" : ""}.`);
    if (findings.length) publishBlockers.push(INCOME_BLOCK);
  } else publishBlockers.push("This course version uses the earlier flow: publish its lessons one by one below. A new version uses the Owner's review.");
  return {
    course: academy,
    version: { id: latest.id, version: latest.version, status: latest.status, ownerReviewRequired: latest.owner_review_required, isDraft: latest.status === "draft", publishedAt: latest.published_at, unpublishedAt: latest.unpublished_at,
      sizeTier: sized ? latest.size_tier : null },
    capstone: extra?.capstone ?? null, business: extra?.business ?? false, notices: { license: latest.license_notice ?? null, software: latest.software_notice ?? null },
    live: liveVersion ? { id: liveVersion.id, version: liveVersion.version, unpublishedAt: liveVersion.unpublished_at } : null,
    modules, findings, emptySlots, boosters, canPublish: !publishBlockers.length, publishBlockers,
  };
}

/** C2: the capstone and notices of a course version, and the income-claims check over them. */
async function courseExtras(c: CourseRow, slug: string) {
  const db = getDb();
  const capstone = (await db.from("course_capstones").select("title, brief, deliverables, checklist, automation, plans_checked_on").eq("course_id", c.id).maybeSingle()).data as
    { title: string; brief: string; deliverables: string[]; checklist: string[]; automation: { what: string; prompts: string[]; plans: unknown[] } | null; plans_checked_on: string | null } | null;
  const topic = (await db.from("topics").select("kind").eq("catalog_slug", slug).maybeSingle()).data as { kind: string } | null;
  const findings = scanTexts([
    { where: "Course › business license notice", text: c.license_notice ?? null },
    { where: "Course › software or AI plan notice", text: c.software_notice ?? null },
    ...(capstone ? [{ where: `Capstone "${capstone.title}"`, text: textsOf(capstone).join(" \n ") }] : []),
  ]);
  return { capstone, business: topic?.kind === "business", findings };
}

export function slotView(s: SlotRow, uploads: UploadRow[]) {
  const up = uploads.find((u) => u.id === s.current_upload_id) ?? null;
  return {
    id: s.id, position: s.position, title: s.title, lessonId: s.lesson_id, status: s.status, brief: s.brief, briefText: briefText(s.title, s.brief ?? {}),
    briefBy: s.brief_generated_by, briefEditedAt: s.brief_edited_at, transcript: s.transcript ?? "", approvedAt: s.approved_at,
    importance: s.importance ?? null, notebookNote: s.notebook_note ?? null,
    file: up ? { name: up.original_name, size: up.size_bytes, mime: up.mime, uploadedAt: up.uploaded_at } : null,
    history: uploads.filter((u) => u.slot_id === s.id).map((u) => ({ id: u.id, name: u.original_name, size: u.size_bytes, status: u.status, reason: u.reject_reason, uploadedAt: u.uploaded_at, replacedAt: u.replaced_at })),
  };
}

export async function activeBoosters(): Promise<{ key: string; name: string; description: string; itemTypes: string[] }[]> {
  const rows = ((await getDb().from("booster_types").select("key, name, description, item_types, active, sort_order").order("sort_order", { ascending: true })).data ?? []) as
    { key: string; name: string; description: string; item_types: string[]; active: boolean }[];
  return rows.filter((b) => b.active).map((b) => ({ key: b.key, name: b.name, description: b.description, itemTypes: b.item_types }));
}

// ============ The Owner's review ============

async function moduleInCourse(slug: string, moduleId: string) {
  if (!isUuid(moduleId)) return null;
  const academy = await academyOf(slug);
  if (!academy) return null;
  const db = getDb();
  const m = (await db.from("modules").select("id, course_id, position, title, stage, recipe, recommended_pace").eq("id", moduleId).maybeSingle()).data as ModuleRow | null;
  if (!m) return null;
  const c = (await db.from("courses").select("*").eq("id", m.course_id).maybeSingle()).data as CourseRow | null;
  return c && c.academy_id === academy.id ? { academy, course: c, module: m } : null;
}

/** The Owner approves a module: exactly the versions and items shown, recorded with the date. Body: none. */
export async function approveModule(actor: Account, slug: string, moduleId: string): Promise<Result> {
  const A = "courses.owner_review";
  const found = await moduleInCourse(slug, moduleId);
  if (!found) return refused(404, "No such module in this course.", A);
  const target = { type: "module", id: moduleId, label: `${slug} v${found.course.version}: ${found.module.title}` };
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner gives the final approval.", A, target);
  if (!found.course.owner_review_required) return refused(409, "This course version uses the earlier flow (no Owner review step). Start a new version to use it.", A, target);
  const l = await loadVersion(found.course.id);
  const st = moduleState(l, found.module, incomeFindings(l), isSizeTier(found.course.size_tier));
  if (st.review?.current) return refused(409, "You've already approved this module as it is now.", A, target);
  if (!st.ready) return refused(409, `Not ready for your approval: ${st.blockers.join(" ")}`, A, target);
  const { data, error } = await getDb().from("module_reviews").insert({
    module_id: moduleId, course_id: found.course.id, decision: "approved", lesson_version_ids: st.candidates, item_ids: st.itemIds, decided_by_account_id: actor.id,
  }).select("id, decided_at").single();
  if (error) {
    if (/check_violation|ASCENTRA/.test(error.message)) return refused(409, error.message.replace(/^ASCENTRA: /, ""), A, target);
    throw new Error(`module review failed: ${error.message}`);
  }
  const row = data as { id: string; decided_at: string };
  return {
    ok: true, status: 201, body: { moduleId, decision: "approved", decidedAt: row.decided_at },
    event: {
      action: A, result: "Completed", target, previous: st.review ? st.review.decision : "not reviewed", next: "approved by the Owner",
      context: `The Owner approved module ${found.module.position} "${found.module.title}" (${st.candidates.length} lesson version(s), ${st.itemIds.length} practice item(s)). Review record ${row.id}.`,
    },
  };
}

/** The Owner sends a module back with a note: its versions in Review return to Draft, with the note shown. Body: { note }. */
export async function sendBackModule(actor: Account, slug: string, moduleId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.owner_review";
  const found = await moduleInCourse(slug, moduleId);
  if (!found) return refused(404, "No such module in this course.", A);
  const target = { type: "module", id: moduleId, label: `${slug} v${found.course.version}: ${found.module.title}` };
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner sends a module back.", A, target);
  const note = clean(body.note, 1000);
  if (note.length < 5) return refused(400, "Say what needs to change. The note is shown to the course builders.", A, target);
  const { error } = await getDb().from("module_reviews").insert({ module_id: moduleId, course_id: found.course.id, decision: "sent_back", note, decided_by_account_id: actor.id });
  if (error) throw new Error(`module review failed: ${error.message}`);
  return {
    ok: true, status: 201, body: { moduleId, decision: "sent_back" },
    event: { action: A, result: "Completed", target, previous: "in review", next: "sent back to Draft", context: `The Owner sent module ${found.module.position} "${found.module.title}" back: ${note}` },
  };
}

async function setTopicsHaveCourse(slug: string, has: boolean) {
  await getDb().from("topics").update({ has_course: has }).eq("catalog_slug", slug);
}

/**
 * The Owner publishes the course: every module approved, the approved lesson versions and practice items go live
 * together, and a course hidden earlier is shown again. Linked topics then show the course instead of "Course coming".
 */
export async function publishCourse(actor: Account, slug: string): Promise<Result> {
  const A = "courses.publish_course";
  const academy = await academyOf(slug);
  if (!academy) return refused(404, "No such course.", A);
  const target = { type: "course", id: slug, label: academy.name };
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner publishes a course.", A, target);
  const studio = await courseStudio(actor, slug);
  if (!studio?.version) return refused(404, "No course version to publish.", A, target);
  const latest = (await coursesOf(academy.id))[0];
  if (latest.status !== "draft" && !latest.unpublished_at && studio.modules.every((m) => !m.lessons.some((x) => x.open?.status === "review"))
      && studio.modules.every((m) => !m.items.some((i) => i.status === "approved"))) {
    return refused(409, "Nothing to publish: this version is already live.", A, target);
  }
  if (!studio.canPublish) return refused(409, `Not ready to publish: ${studio.publishBlockers.join(" ")}`, A, target);
  const db = getDb();
  const l = await loadVersion(latest.id);
  let lessons = 0;
  let items = 0;
  for (const m of l.modules) {
    const review = l.reviews.find((r) => r.module_id === m.id)!;
    for (const vid of review.lesson_version_ids) {
      const v = l.versions.find((x) => x.id === vid);
      if (v?.status !== "review") continue;
      const { error } = await db.from("lesson_versions").update({ status: "published", published_at: new Date().toISOString(), published_by_account_id: actor.id }).eq("id", vid);
      if (error) return refused(409, `"${v.title}" couldn't be published: ${error.message.replace(/^ASCENTRA: /, "")}`, A, target);
      lessons++;
    }
    if (l.items.some((i) => i.module_id === m.id && i.status === "approved")) {
      const { data, error } = await db.rpc("publish_module_activities", { p_module: m.id, p_actor: actor.id });
      if (error) return refused(409, `Practice in "${m.title}" couldn't be published: ${error.message.replace(/^ASCENTRA: /, "")}`, A, target);
      items += Number(data);
    }
  }
  const wasHidden = !!latest.unpublished_at;
  if (wasHidden) await db.from("courses").update({ unpublished_at: null, unpublished_by_account_id: null, unpublish_note: null }).eq("id", latest.id);
  await setTopicsHaveCourse(slug, true);
  return {
    ok: true, body: { published: true, lessons, items, emptySlots: studio.emptySlots },
    event: {
      action: A, result: "Completed", target, previous: wasHidden ? "unpublished" : latest.status, next: "published",
      context: `The Owner published "${academy.name}" v${latest.version}: ${lessons} lesson version(s) and ${items} practice item(s) went live${studio.emptySlots ? `; ${studio.emptySlots} video slot(s) show "Video coming"` : ""}.`,
    },
  };
}

/** The Owner unpublishes: hidden from new learners; everyone who started keeps their access and progress. Body: { note? }. */
export async function unpublishCourse(actor: Account, slug: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.publish_course";
  const academy = await academyOf(slug);
  if (!academy) return refused(404, "No such course.", A);
  const target = { type: "course", id: slug, label: academy.name };
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner unpublishes a course.", A, target);
  const liveVersion = (await coursesOf(academy.id)).find(isLive);
  if (!liveVersion) return refused(409, "This course isn't published.", A, target);
  if (liveVersion.unpublished_at) return refused(409, "This course is already unpublished.", A, target);
  const note = clean(body.note, 500) || null;
  const { error } = await getDb().from("courses").update({ unpublished_at: new Date().toISOString(), unpublished_by_account_id: actor.id, unpublish_note: note }).eq("id", liveVersion.id);
  if (error) throw new Error(`unpublish failed: ${error.message}`);
  await setTopicsHaveCourse(slug, false);
  return {
    ok: true, body: { unpublished: true },
    event: { action: A, result: "Completed", target, previous: "published", next: "unpublished", context: `The Owner unpublished "${academy.name}": hidden from new learners; learners who started keep access and their progress.${note ? ` Note: ${note}` : ""}` },
  };
}

/** The Owner's review checklist, across every course: what waits for review, what was sent back, empty video slots, the income check. */
export async function reviewChecklist(actor: Account) {
  const db = getDb();
  const academies = (((await db.from("academies").select("id, slug, name").order("name", { ascending: true })).data ?? []) as Academy[]).filter((a) => canSeeCourse(actor, a.slug));
  const out = [];
  for (const a of academies) {
    const latest = (await coursesOf(a.id))[0];
    if (!latest?.owner_review_required) continue;
    const l = await loadVersion(latest.id);
    const findings = incomeFindings(l);
    const modules = l.modules.map((m) => ({ m, st: moduleState(l, m, findings, isSizeTier(latest.size_tier)) }));
    out.push({
      slug: a.slug, name: a.name, version: latest.version, status: latest.status, unpublished: !!latest.unpublished_at,
      waiting: modules.filter(({ st }) => st.ready && !st.review?.current).map(({ m }) => ({ id: m.id, position: m.position, title: m.title })),
      notReady: modules.filter(({ st }) => !st.ready && st.review?.decision !== "sent_back").map(({ m, st }) => ({ id: m.id, position: m.position, title: m.title, blockers: st.blockers })),
      sentBack: modules.filter(({ st }) => st.review?.decision === "sent_back").map(({ m, st }) => ({ id: m.id, position: m.position, title: m.title, note: st.review!.note, at: st.review!.decidedAt })),
      approved: modules.filter(({ st }) => st.review?.current).length,
      modules: l.modules.length,
      emptySlots: l.slots.filter((s) => s.status !== "approved").map((s) => ({ id: s.id, title: s.title, status: s.status, module: l.modules.find((m) => m.id === s.module_id)?.position ?? 0 })),
      income: { ok: !findings.length, findings },
    });
  }
  return { courses: out };
}
