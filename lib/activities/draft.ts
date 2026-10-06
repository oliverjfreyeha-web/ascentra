import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AiUnavailable, structured } from "@/lib/ai";
import { AI_MODELS, estimateUsd } from "@/lib/ai/config";
import { ATTORNEY, clean, courseScope, isUuid, longestSharedRun, refused, type Result } from "@/lib/courses/common";
import { MAX_COPIED_WORDS, type Citation, type LessonBody } from "@/lib/courses/lessons";
import { approvedSources, passagesFor, renderContext, type CourseSource, type Passage } from "@/lib/courses/passages";
import { ITEM_TYPES, LEVELS, checkItem, gradingOf, seededOrder, type AnswerKey, type Content, type ItemType } from "./types";

/**
 * L6: pool drafting. For one lesson, Claude (Haiku 4.5) proposes a pool of varied practice items from the lesson's
 * APPROVED sources: each item tagged by level (beginner or intermediate), goal and interest tags, and tied to the
 * numbered passage it rests on, which becomes its citation. Variants of the same idea share an idea key, so L7's
 * personalization has choices. Code-graded items carry an answer key; feedback-only items carry what to reveal after a
 * try. Everything enters as Draft for a Reviewer; nothing is generated per learner. An item without a valid passage,
 * an incomplete one, or one that copies a source too closely is dropped and counted. If the lesson already has
 * published items, a new item with the same idea and type points at the one it would replace (a refresh never edits a
 * published item).
 */
const A = "courses.activities.draft";
const MAX_ITEMS = 16;

export const POOL_SYSTEM = [
  "You write practice items for one lesson of a course on a learning platform, from the numbered passages of approved sources.",
  "Write 8 to 14 items, using at least 5 different types, for both levels (beginner and intermediate). Types:",
  "- multiple_choice: options (2-6) and correctIndex. true_false: the prompt is the statement; correctBool.",
  "- matching: pairsLeft and pairsRight in matching order (2-6 pairs). ordering: steps in the correct order (3-7).",
  "- flashcard: front and back.",
  "- short_answer: sampleAnswer. build_it and mini_project: checklist (2-10 steps). branching_scenario: branches (2-4), each",
  "  with text, outcome and fit (strong, workable or weak). spot_the_mistake: passageText containing one mistake, and mistake.",
  "  case_teardown: caseText, questions (1-5) and keyPoints. teach_back: keyPoints a good explanation covers.",
  "Every item: a short ideaKey (lowercase words with dashes; variants of the same idea share it), level, goal (what it practices),",
  "interests (1-3 short tags such as home-services or retail), prompt, explanation (why the answer is right, from the passage),",
  "and passage: the number of the one passage it rests on. Use only what the passages say; paraphrase, never copy more than a",
  "short phrase. Never ask the learner for personal details. Don't describe anything as legally or attorney approved.",
].join("\n");

const PoolSchema = z.object({
  items: z.array(z.object({
    type: z.enum(ITEM_TYPES), level: z.enum(LEVELS), ideaKey: z.string(), goal: z.string(), interests: z.array(z.string()),
    prompt: z.string(), explanation: z.string(), passage: z.number().int(),
    options: z.array(z.string()).optional(), correctIndex: z.number().int().optional(), correctBool: z.boolean().optional(),
    pairsLeft: z.array(z.string()).optional(), pairsRight: z.array(z.string()).optional(), steps: z.array(z.string()).optional(),
    front: z.string().optional(), back: z.string().optional(), sampleAnswer: z.string().optional(), checklist: z.array(z.string()).optional(),
    branches: z.array(z.object({ text: z.string(), outcome: z.string(), fit: z.enum(["strong", "workable", "weak"]) })).optional(),
    passageText: z.string().optional(), mistake: z.string().optional(), caseText: z.string().optional(), questions: z.array(z.string()).optional(),
    keyPoints: z.array(z.string()).optional(),
  })),
});
export type Pool = z.infer<typeof PoolSchema>;

export type DraftItem = {
  item_type: ItemType; grading: "code" | "feedback"; level: "beginner" | "intermediate"; idea_key: string; goal: string; interests: string[];
  prompt: string; content: Content; answer_key: AnswerKey; explanation: string;
  citation: { sourceId: string; title: string; url: string | null; quote: string; lastChecked: string | null };
};

const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const list = (v: string[] | undefined, n: number, each = 300) => (v ?? []).map((x) => clean(x, each)).filter(Boolean).slice(0, n);

/** The model's items as Draft rows: cited, complete, not copied, shown order shuffled. Pure: tested on its own. */
export function toPoolItems(g: Pool, passages: Passage[], sources: CourseSource[]): { items: DraftItem[]; dropped: { reason: string; prompt: string }[] } {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const src = new Map(sources.map((s) => [s.id, s]));
  const items: DraftItem[] = [];
  const dropped: { reason: string; prompt: string }[] = [];
  for (const [i, it] of g.items.slice(0, MAX_ITEMS * 2).entries()) {
    const prompt = clean(it.prompt, 2000);
    const drop = (reason: string) => dropped.push({ reason, prompt: prompt.slice(0, 120) });
    const p = byN.get(it.passage);
    const s = p ? src.get(p.sourceId) : undefined;
    if (!p || !s) { drop("no passage to cite"); continue; }
    const text = [prompt, it.explanation, it.sampleAnswer, it.back, ...(it.options ?? [])].filter(Boolean).join(" ");
    if (ATTORNEY.test(text)) { drop("calls something attorney-approved"); continue; }
    if (Math.max(0, ...passages.map((x) => longestSharedRun(text, x.text))) > MAX_COPIED_WORDS) { drop("copies a source too closely"); continue; }
    const seed = `${it.ideaKey}:${i}`;
    let content: Content = {};
    let key: AnswerKey = null;
    switch (it.type) {
      case "multiple_choice": content = { options: list(it.options, 6) }; key = { correct: it.correctIndex ?? -1 }; break;
      case "true_false": key = typeof it.correctBool === "boolean" ? { correct: it.correctBool } : {}; break;
      case "matching": {
        const left = list(it.pairsLeft, 6);
        const right = list(it.pairsRight, 6);
        const order = seededOrder(right.length, seed); // shown position -> original index
        content = { left, right: order.map((o) => right[o]) };
        key = { pairs: left.map((_, li) => order.indexOf(li)) };
        break;
      }
      case "ordering": {
        const steps = list(it.steps, 7);
        const order = seededOrder(steps.length, seed);
        content = { steps: order.map((o) => steps[o]) };
        key = { order: steps.map((_, si) => order.indexOf(si)) };
        break;
      }
      case "flashcard": content = { front: clean(it.front, 300) }; key = { back: clean(it.back, 600) }; break;
      case "short_answer": content = { sampleAnswer: clean(it.sampleAnswer, 2000) }; break;
      case "build_it": case "mini_project": content = { checklist: list(it.checklist, 10) }; break;
      case "branching_scenario": content = { options: (it.branches ?? []).slice(0, 4).map((b) => ({ text: clean(b.text, 300), outcome: clean(b.outcome, 600), fit: b.fit })) }; break;
      case "spot_the_mistake": content = { passage: clean(it.passageText, 2000), mistake: clean(it.mistake, 600) }; break;
      case "case_teardown": content = { caseText: clean(it.caseText, 2000), questions: list(it.questions, 5), keyPoints: list(it.keyPoints, 8) }; break;
      case "teach_back": content = { keyPoints: list(it.keyPoints, 8) }; break;
    }
    const problem = checkItem(it.type, content, key);
    if (problem) { drop(`incomplete: ${problem}`); continue; }
    items.push({
      item_type: it.type, grading: gradingOf(it.type), level: it.level, idea_key: slugKey(it.ideaKey) || `${it.type.replace(/_/g, "-")}-${i + 1}`,
      goal: clean(it.goal, 300) || "Practice this lesson", interests: list(it.interests, 3, 40).map(slugKey).filter(Boolean),
      prompt, content, answer_key: key, explanation: clean(it.explanation, 2000),
      citation: { sourceId: s.id, title: s.title, url: s.url, quote: p.quote, lastChecked: s.lastChecked },
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return { items, dropped };
}

type LessonRow = { id: string; module_id: string; title: string; objectives: string[]; content: { blueprintId?: string } };
export type LessonPlace = { lesson: LessonRow; courseId: string; academyId: string; slug: string };

/** The lesson, if it belongs to this course (by slug). */
export async function lessonPlace(slug: string, lessonId: string): Promise<LessonPlace | null> {
  if (!isUuid(lessonId)) return null;
  const db = getDb();
  const lesson = (await db.from("lessons").select("id, module_id, title, objectives, content").eq("id", lessonId).maybeSingle()).data as LessonRow | null;
  if (!lesson) return null;
  const mod = (await db.from("modules").select("course_id").eq("id", lesson.module_id).maybeSingle()).data as { course_id: string } | null;
  const course = mod ? ((await db.from("courses").select("id, academy_id").eq("id", mod.course_id).maybeSingle()).data as { id: string; academy_id: string } | null) : null;
  const academy = course ? ((await db.from("academies").select("id, slug").eq("id", course.academy_id).maybeSingle()).data as { id: string; slug: string } | null) : null;
  return course && academy?.slug === slug ? { lesson, courseId: course.id, academyId: academy.id, slug } : null;
}

/** The lesson text items are written from: the published version, else the newest draft. */
async function lessonText(lessonId: string): Promise<{ body: LessonBody; citations: Citation[] } | null> {
  const vs = ((await getDb().from("lesson_versions").select("status, version, body, citations").eq("lesson_id", lessonId)).data ?? []) as
    { status: string; version: number; body: LessonBody; citations: Citation[] }[];
  const pub = vs.find((v) => v.status === "published");
  return pub ?? vs.filter((v) => v.status !== "archived").sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Claude drafts the lesson's pool, as Draft items. Also used by the batch pipeline after a lesson is drafted. */
export async function draftPool(actor: Account, slug: string, lessonId: string, requestId?: string): Promise<Result> {
  const scope = courseScope(actor, "courses.edit", slug);
  const place = await lessonPlace(slug, lessonId);
  if (!place) return refused(404, "No such lesson in this course.", A);
  const target = { type: "lesson", id: lessonId, label: place.lesson.title };
  if (scope) return refused(403, scope, A, target);
  const db = getDb();
  const existing = ((await db.from("activity_items").select("id, status, idea_key, item_type, version").eq("lesson_id", lessonId)).data ?? []) as
    { id: string; status: string; idea_key: string; item_type: string; version: number }[];
  if (existing.some((e) => e.status === "draft")) return refused(409, "This lesson already has Draft items. Review those first.", A, target);
  const text = await lessonText(lessonId);
  if (!text) return refused(409, "This lesson has no text yet. Draft the lesson first.", A, target);
  let sourceIds = [...new Set(text.citations.map((c) => c.sourceId))];
  const bpId = place.lesson.content?.blueprintId;
  if (!sourceIds.length && isUuid(bpId)) {
    sourceIds = (((await db.from("academy_blueprints").select("source_ids").eq("id", bpId).maybeSingle()).data as { source_ids: string[] } | null)?.source_ids ?? []);
  }
  const sources = await approvedSources(sourceIds);
  if (!sources.length) return refused(409, "None of the sources this lesson cites is approved. Items are written only from approved sources.", A, target);
  const passages = await passagesFor(sources);
  if (!passages.length) return refused(422, "The lesson's sources have no passages to work from yet.", A, target);

  const lines = [text.body.summary, ...text.body.sections.flatMap((s) => [s.heading, ...s.paragraphs.map((p) => p.text)])].filter(Boolean).join("\n").slice(0, 6000);
  let pool: Pool;
  try {
    pool = await structured("activities.draft", {
      system: POOL_SYSTEM, cachedContext: renderContext(sources, passages),
      user: [`Lesson: ${place.lesson.title}`, place.lesson.objectives?.length ? `Objectives:\n${place.lesson.objectives.map((o) => `- ${o}`).join("\n")}` : "", `Lesson text:\n${lines}`].filter(Boolean).join("\n"),
      schema: PoolSchema, maxTokens: 12_000, timeoutMs: 180_000, estimateUsd: estimateUsd("activityPool"), accountId: actor.id, requestId,
    });
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    return refused(err.code === "ai_off" ? 503 : err.code === "cap_reached" ? 429 : 502, err.message, A, target);
  }
  const { items, dropped } = toPoolItems(pool, passages, sources);
  if (!items.length) return refused(502, "The model didn't propose any usable items. Nothing was saved.", A, target);
  const published = existing.filter((e) => e.status === "published");
  const rows = items.map((it) => {
    const prev = published.find((p) => p.idea_key === it.idea_key && p.item_type === it.item_type);
    return {
      ...it, lesson_id: lessonId, module_id: place.lesson.module_id, course_id: place.courseId, status: "draft", generated_by: "ai",
      model: AI_MODELS["activities.draft"], created_by_account_id: actor.id, previous_item_id: prev?.id ?? null, version: prev ? prev.version + 1 : 1,
    };
  });
  const { error } = await db.from("activity_items").insert(rows);
  if (error) throw new Error(`activity items insert failed: ${error.message}`);
  const types = new Set(items.map((i) => i.item_type)).size;
  const replacing = rows.filter((r) => r.previous_item_id).length;
  return {
    ok: true, status: 201,
    body: { drafted: items.length, types, code: items.filter((i) => i.grading === "code").length, dropped: dropped.length, replacing },
    event: {
      action: A, result: "Completed", target, previous: `${published.length} published item(s)`, next: `${items.length} draft item(s)`,
      context: `AI drafted ${items.length} practice item(s) of ${types} type(s) for "${place.lesson.title}" from ${sources.length} approved source(s), each with its citation${dropped.length ? `; ${dropped.length} dropped (no passage, incomplete or copied)` : ""}${replacing ? `; ${replacing} would replace a published item after review` : ""}. They reach learners only after review and publishing.`,
    },
  };
}
