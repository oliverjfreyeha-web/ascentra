import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AiUnavailable, structured } from "@/lib/ai";
import { AI_MODELS, estimateUsd } from "@/lib/ai/config";
import { ATTORNEY, NO_ATTORNEY, clean, courseScope, isUuid, longestSharedRun, refused, type Result } from "./common";
import { approvedSources, passagesFor, renderContext, type CourseSource, type Passage } from "./passages";
import type { KeyClaim } from "./blueprint";
import { incomeReason, lessonFindings } from "./income";

/**
 * L2 steps 3 and 4: drafting a lesson, and its review.
 *   - From the approved Blueprint, Claude (Sonnet 5.5) writes the lesson in its own words. Each paragraph cites the
 *     passages it rests on; the server turns those into numbered citations of real, approved sources. A paragraph
 *     with no citation is shown as having no source. A paragraph that copies a source too closely (a run of more than
 *     MAX_COPIED_WORDS words) is removed and the removal noted. The course's sources and passages are the same for
 *     every lesson, so they are sent as a cached block: drafting the second lesson reads them from the cache.
 *   - "Last verified" is the oldest last-checked date among the sources the lesson cites.
 *   - Each draft is a new Draft version. Draft -> Review (submitted) -> verified by a Reviewer -> Published. A Reviewer
 *     can send it back to Draft. The database holds these rules (0013); the API checks the course scope.
 */
export const MAX_COPIED_WORDS = 20;

export const LESSON_SYSTEM = [
  "You write one lesson of a course for a learning platform, in your own words, from the numbered passages of approved sources.",
  "- Write for the audience level given. Clear, concrete, and practical.",
  "- 2 to 6 sections, each with a heading and 1 to 4 short paragraphs; then 2 to 5 key takeaways.",
  "- After each paragraph and takeaway, list the numbers of the passages it rests on. Use only what the passages say.",
  "- Paraphrase. Quote at most a short phrase, in quotation marks, and never more than 15 words in a row from a passage.",
  "- If something essential isn't in any passage, you may say it with an empty passage list: it will be marked as having no source.",
  "- Don't teach practices the outline lists as outdated, except to say what replaced them.",
  "- Don't claim this is the best or only way. Never describe anything as legally or attorney approved.",
].join("\n");

const LessonSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.object({ text: z.string(), passages: z.array(z.number().int()) })) })),
  takeaways: z.array(z.object({ text: z.string(), passages: z.array(z.number().int()) })),
});
type Written = z.infer<typeof LessonSchema>;

export type Citation = { ref: number; sourceId: string; title: string; url: string | null; license: string; lastChecked: string | null };
export type Para = { text: string; refs: number[] };
export type LessonBody = { summary: string; sections: { heading: string; paragraphs: Para[] }[]; takeaways: Para[] };

/**
 * Turns the model's answer into a lesson body with numbered citations, dropping copied paragraphs. Pure: tested on
 * its own.
 */
export function toLessonBody(w: Written, passages: Passage[], sources: CourseSource[]) {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const citations: Citation[] = [];
  const refFor = (sourceId: string) => {
    let c = citations.find((x) => x.sourceId === sourceId);
    if (!c) {
      const s = srcById.get(sourceId)!;
      c = { ref: citations.length + 1, sourceId, title: s.title, url: s.url, license: s.license, lastChecked: s.lastChecked };
      citations.push(c);
    }
    return c.ref;
  };
  const removed: { text: string; copiedWords: number }[] = [];
  const para = (p: { text: string; passages: number[] }): Para | null => {
    const text = clean(p.text, 2000);
    if (!text || ATTORNEY.test(text)) return null;
    const used = [...new Set(p.passages)].map((n) => byN.get(n)).filter((x): x is Passage => !!x);
    const copied = Math.max(0, ...passages.map((x) => longestSharedRun(text, x.text)));
    if (copied > MAX_COPIED_WORDS) {
      removed.push({ text: text.slice(0, 160), copiedWords: copied });
      return null;
    }
    return { text, refs: [...new Set(used.map((u) => refFor(u.sourceId)))].sort((a, b) => a - b) };
  };
  const body: LessonBody = {
    summary: clean(w.summary, 600),
    sections: w.sections.slice(0, 8).map((s) => ({ heading: clean(s.heading, 200), paragraphs: s.paragraphs.slice(0, 6).map(para).filter((p): p is Para => !!p) }))
      .filter((s) => s.heading && s.paragraphs.length),
    takeaways: w.takeaways.slice(0, 6).map(para).filter((p): p is Para => !!p),
  };
  const all = [...body.sections.flatMap((s) => s.paragraphs), ...body.takeaways];
  const uncited = all.filter((p) => !p.refs.length).length;
  const dates = citations.map((c) => c.lastChecked).filter((d): d is string => !!d).sort();
  return { body, citations, uncited, removed, lastVerifiedOn: dates[0] ?? null };
}

type LessonCtx = {
  lesson: { id: string; title: string; minutes: number | null; objectives: string[]; content: { keyClaims?: KeyClaim[]; blueprintId?: string } };
  course: { id: string; status: string; version: number };
  blueprint: { id: string; plan: { title: string; modules: { title: string; lessons: { title: string }[] }[] }; source_ids: string[]; audience_level: string; outdated_notes: { item: string; replacedBy: string | null }[] } | null;
};

async function lessonInCourse(slug: string, lessonId: string): Promise<LessonCtx | null> {
  if (!isUuid(lessonId)) return null;
  const db = getDb();
  const lesson = (await db.from("lessons").select("id, title, minutes, objectives, content, module_id").eq("id", lessonId).maybeSingle()).data as (LessonCtx["lesson"] & { module_id: string }) | null;
  if (!lesson) return null;
  const mod = (await db.from("modules").select("course_id").eq("id", lesson.module_id).maybeSingle()).data as { course_id: string } | null;
  const course = mod ? ((await db.from("courses").select("id, status, version, academy_id").eq("id", mod.course_id).maybeSingle()).data as (LessonCtx["course"] & { academy_id: string }) | null) : null;
  const academy = course ? ((await db.from("academies").select("slug").eq("id", course.academy_id).maybeSingle()).data as { slug: string } | null) : null;
  if (!course || academy?.slug !== slug) return null;
  const bpId = lesson.content?.blueprintId;
  const blueprint = isUuid(bpId) ? ((await db.from("academy_blueprints").select("id, plan, source_ids, audience_level, outdated_notes").eq("id", bpId).maybeSingle()).data as LessonCtx["blueprint"]) : null;
  return { lesson, course, blueprint };
}

/** Claude drafts the lesson as a new Draft version. */
export async function draftLesson(actor: Account, slug: string, lessonId: string, requestId?: string): Promise<Result> {
  const A = "courses.lesson.draft";
  const scope = courseScope(actor, "courses.edit", slug);
  const ctx = await lessonInCourse(slug, lessonId);
  if (!ctx) return refused(404, "No such lesson in this course.", A);
  const target = { type: "lesson", id: lessonId, label: ctx.lesson.title };
  if (scope) return refused(403, scope, A, target);
  if (ctx.course.status === "archived") return refused(409, "This course version is archived.", A, target);
  if (!ctx.blueprint) return refused(409, "This lesson has no approved Blueprint to draft from.", A, target);
  const db = getDb();
  const versions = ((await db.from("lesson_versions").select("version, status").eq("lesson_id", lessonId)).data ?? []) as { version: number; status: string }[];
  if (versions.some((v) => v.status === "draft" || v.status === "review")) return refused(409, "This lesson already has a Draft or a version in Review. Finish that one first.", A, target);

  const sources = await approvedSources(ctx.blueprint.source_ids);
  if (!sources.length) return refused(409, "None of the Blueprint's sources is approved any more.", A, target);
  const passages = await passagesFor(sources);
  const keyClaims = (ctx.lesson.content?.keyClaims ?? []).map((c) => {
    const p = c.sourceId ? passages.find((x) => x.sourceId === c.sourceId && (!c.claimId || x.claimId === c.claimId)) : undefined;
    return `- ${c.claim}${p ? ` (passage P${p.n})` : " (no source)"}`;
  });
  const outline = ctx.blueprint.plan.modules.map((m, i) => `Module ${i + 1}: ${m.title}\n${m.lessons.map((l) => `  - ${l.title}`).join("\n")}`).join("\n");
  const cached = [
    `Course: ${ctx.blueprint.plan.title}`, `Audience level: ${ctx.blueprint.audience_level}`, `Outline:\n${outline}`,
    ctx.blueprint.outdated_notes?.length ? `Outdated, according to the research:\n${ctx.blueprint.outdated_notes.map((n) => `- ${n.item}${n.replacedBy ? ` -> ${n.replacedBy}` : ""}`).join("\n")}` : "",
    "", renderContext(sources, passages),
  ].join("\n");

  let written: Written;
  try {
    written = await structured("lessons.draft", {
      system: LESSON_SYSTEM, cachedContext: cached,
      user: [
        `Write the lesson "${ctx.lesson.title}"${ctx.lesson.minutes ? ` (about ${ctx.lesson.minutes} minutes)` : ""}.`,
        ctx.lesson.objectives.length ? `Objectives:\n${ctx.lesson.objectives.map((o) => `- ${o}`).join("\n")}` : "",
        keyClaims.length ? `Key claims to teach:\n${keyClaims.join("\n")}` : "",
      ].filter(Boolean).join("\n"),
      schema: LessonSchema, maxTokens: 16_000, timeoutMs: 240_000, estimateUsd: estimateUsd("lesson"), accountId: actor.id, requestId,
    });
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    return refused(err.code === "ai_off" ? 503 : err.code === "cap_reached" ? 429 : 502, err.message, A, target);
  }
  const out = toLessonBody(written, passages, sources);
  if (!out.body.sections.length) return refused(502, "The draft had no usable sections. Nothing was saved.", A, target);
  const version = Math.max(0, ...versions.map((v) => v.version)) + 1;
  const { data, error } = await db.from("lesson_versions").insert({
    lesson_id: lessonId, course_id: ctx.course.id, version, status: "draft", title: ctx.lesson.title, body: out.body, citations: out.citations,
    uncited_count: out.uncited, checks: { removedForCopying: out.removed, maxCopiedWords: MAX_COPIED_WORDS }, last_verified_on: out.lastVerifiedOn,
    generated_by: "ai", model: AI_MODELS["lessons.draft"], blueprint_id: ctx.blueprint.id, created_by_account_id: actor.id,
  }).select("id").single();
  if (error?.code === "23505") return refused(409, "Another draft of this lesson was saved at the same time. Reload.", A, target);
  if (error) throw new Error(`lesson version insert failed: ${error.message}`);
  const id = (data as { id: string }).id;
  return {
    ok: true, status: 201, body: { id, version, citations: out.citations.length, uncited: out.uncited, removed: out.removed.length, lastVerifiedOn: out.lastVerifiedOn },
    event: {
      action: A, result: "Completed", target: { type: "lesson_version", id, label: `${ctx.lesson.title} v${version}` }, previous: versions.length ? `v${version - 1}` : "none",
      next: `v${version} draft`,
      context: `AI drafted "${ctx.lesson.title}" v${version} as a Draft: ${out.citations.length} source(s) cited${out.uncited ? `, ${out.uncited} paragraph(s) with no source (marked)` : ""}${out.removed.length ? `, ${out.removed.length} paragraph(s) removed for copying a source too closely` : ""}; last verified ${out.lastVerifiedOn ?? "unknown"}. It reaches learners only after review and publishing.`,
    },
  };
}

type VersionRow = {
  id: string; lesson_id: string; course_id: string; version: number; status: string; title: string; verified_by_account_id: string | null;
  body: LessonBody; citations: Citation[];
};

async function versionInCourse(slug: string, id: string): Promise<VersionRow | null> {
  if (!isUuid(id)) return null;
  const db = getDb();
  const v = (await db.from("lesson_versions").select("*").eq("id", id).maybeSingle()).data as VersionRow | null;
  if (!v) return null;
  const course = (await db.from("courses").select("academy_id").eq("id", v.course_id).maybeSingle()).data as { academy_id: string } | null;
  const academy = course ? ((await db.from("academies").select("slug").eq("id", course.academy_id).maybeSingle()).data as { slug: string } | null) : null;
  return academy?.slug === slug ? v : null;
}

const label = (v: VersionRow) => `${v.title} v${v.version}`;

/** Draft -> Review. */
export async function submitVersion(actor: Account, slug: string, id: string): Promise<Result> {
  const A = "courses.lesson.submit";
  const scope = courseScope(actor, "courses.edit", slug);
  const v = await versionInCourse(slug, id);
  if (!v) return refused(404, "No such lesson version in this course.", A);
  const target = { type: "lesson_version", id, label: label(v) };
  if (scope) return refused(403, scope, A, target);
  if (v.status !== "draft") return refused(409, `This version is ${v.status}, not a Draft.`, A, target);
  // C1: the income-claims check. Text that reads as a promise of income or results never goes to review.
  const findings = lessonFindings(v.title, v.body, `"${v.title}" v${v.version}`);
  if (findings.length) return refused(409, incomeReason(findings), A, target);
  // C2: in a course with a size tier, a module goes to review only with every video and practice item labelled.
  const unlabelled = await unlabelledInModule(v.lesson_id, v.course_id);
  if (unlabelled) return refused(409, `Label every video and practice item in this module first (${unlabelled} without an importance label, or "Very important" without its Notebook note).`, A, target);
  const { error } = await getDb().from("lesson_versions").update({ status: "review", submitted_at: new Date().toISOString(), submitted_by_account_id: actor.id }).eq("id", id);
  if (error) throw new Error(`submit failed: ${error.message}`);
  return { ok: true, body: { id, status: "review" }, event: { action: A, result: "Completed", target, previous: "draft", next: "review", context: `Submitted ${label(v)} for review.` } };
}

/** A Reviewer verifies a version in Review (body: { decision: "verify", note }) or returns it to Draft ({ decision: "return", note }). */
export async function reviewVersion(actor: Account, slug: string, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.lesson.verify";
  const scope = courseScope(actor, "courses.review", slug);
  const v = await versionInCourse(slug, id);
  if (!v) return refused(404, "No such lesson version in this course.", A);
  const target = { type: "lesson_version", id, label: label(v) };
  if (scope) return refused(403, scope, A, target);
  const note = clean(body.note, 1000);
  if (body.decision !== "verify" && body.decision !== "return") return refused(400, "Choose verify or return to draft.", A, target);
  if (note.length < 5) return refused(400, body.decision === "verify" ? "Say what you checked (for example: every citation opened and matches)." : "Say what needs to change.", A, target);
  if (ATTORNEY.test(note)) return refused(400, NO_ATTORNEY, A, target);
  if (v.status !== "review") return refused(409, `This version is ${v.status}, not in Review.`, A, target);
  const now = new Date().toISOString();
  const fields = body.decision === "verify"
    ? { verified_at: now, verified_by_account_id: actor.id, verification_note: note }
    : { status: "draft", returned_note: note };
  const { error } = await getDb().from("lesson_versions").update(fields).eq("id", id);
  if (error) throw new Error(`review failed: ${error.message}`);
  return {
    ok: true, body: { id, status: body.decision === "verify" ? "review" : "draft", verified: body.decision === "verify" },
    event: {
      action: A, result: "Completed", target, previous: "review (not verified)", next: body.decision === "verify" ? "review (verified)" : "draft (returned)",
      context: body.decision === "verify" ? `Verified ${label(v)}: ${note}` : `Returned ${label(v)} to Draft: ${note}`,
    },
  };
}

/** A verified version in Review -> Published (the version it replaces is archived; the course version goes live). */
export async function publishVersion(actor: Account, slug: string, id: string): Promise<Result> {
  const A = "courses.release";
  const scope = courseScope(actor, "courses.publish", slug);
  const v = await versionInCourse(slug, id);
  if (!v) return refused(404, "No such lesson version in this course.", A);
  const target = { type: "lesson_version", id, label: label(v) };
  if (scope) return refused(403, scope, A, target);
  if (v.status !== "review") return refused(409, `Only a version in Review is published; this one is ${v.status}.`, A, target);
  if (!v.verified_by_account_id) return refused(409, "A Reviewer has to verify this version before it is published.", A, target);
  const previous = ((await getDb().from("lesson_versions").select("version").eq("lesson_id", v.lesson_id).eq("status", "published")).data ?? []) as { version: number }[];
  const { error } = await getDb().from("lesson_versions").update({ status: "published", published_at: new Date().toISOString(), published_by_account_id: actor.id }).eq("id", id);
  if (error) {
    if (/no longer approved/.test(error.message)) return refused(409, "A source this lesson cites is no longer approved. Re-approve it or draft a new version.", A, target);
    throw new Error(`publish failed: ${error.message}`);
  }
  return {
    ok: true, body: { id, status: "published" },
    event: {
      action: A, result: "Completed", target, previous: previous.length ? `v${previous[0].version} published` : "nothing published", next: `v${v.version} published`,
      context: `Published ${label(v)}${previous.length ? `; v${previous[0].version} archived` : ""}. Learners now see this version.`,
    },
  };
}

/** The lesson as plain lines, for the diff. */
export function lessonLines(body: LessonBody | null | undefined): string[] {
  if (!body) return [];
  return [
    ...(body.summary ? [`Summary: ${body.summary}`] : []),
    ...body.sections.flatMap((s) => [`## ${s.heading}`, ...s.paragraphs.map((p) => `${p.text}${p.refs.length ? ` [${p.refs.join(", ")}]` : " [no source]"}`)]),
    ...body.takeaways.map((t) => `Takeaway: ${t.text}${t.refs.length ? ` [${t.refs.join(", ")}]` : " [no source]"}`),
  ];
}

/** A line diff (longest common subsequence): what was added and removed since the previous version. */
export function diffLines(before: string[], after: string[]): { op: "same" | "add" | "remove"; text: string }[] {
  const n = before.length;
  const m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { op: "same" | "add" | "remove"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) { out.push({ op: "same", text: before[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "remove", text: before[i++] });
    else out.push({ op: "add", text: after[j++] });
  }
  while (i < n) out.push({ op: "remove", text: before[i++] });
  while (j < m) out.push({ op: "add", text: after[j++] });
  return out;
}

/** C2: how many videos and practice items of a lesson's module lack their label (only in a course with a size tier). */
async function unlabelledInModule(lessonId: string, courseId: string): Promise<number> {
  const db = getDb();
  const c = (await db.from("courses").select("size_tier").eq("id", courseId).maybeSingle()).data as { size_tier?: string | null } | null;
  if (!c?.size_tier) return 0;
  const l = (await db.from("lessons").select("module_id").eq("id", lessonId).maybeSingle()).data as { module_id: string } | null;
  if (!l) return 0;
  const ok = (x: { importance?: string | null; notebook_note?: string | null }) => !!x.importance && (x.importance !== "very_important" || !!x.notebook_note);
  const slots = ((await db.from("video_slots").select("importance, notebook_note").eq("module_id", l.module_id)).data ?? []) as { importance: string | null; notebook_note: string | null }[];
  const items = ((await db.from("activity_items").select("importance, notebook_note, status").eq("module_id", l.module_id)).data ?? []) as { importance: string | null; notebook_note: string | null; status: string }[];
  return slots.filter((x) => !ok(x)).length + items.filter((i) => ["draft", "approved", "published"].includes(i.status) && !ok(i)).length;
}
