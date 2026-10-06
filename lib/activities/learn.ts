import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AiUnavailable, aiConfigured, structured } from "@/lib/ai";
import { feedbackEstimate } from "@/lib/ai/config";
import { isUuid, refused, type Result } from "@/lib/courses/common";
import { publishedVersion } from "@/lib/courses/learn";
import { allowanceOf, recordMentorUsage } from "@/lib/mentor-allowance";
import { allowancePause } from "@/lib/mentor/mentor";
import { MAX_MESSAGE_CHARS, redactPersonalData, safetyResponse, safetySignal } from "@/lib/mentor/rules";
import { MIN_MODULE_TYPES, PRACTICE_LABEL, TYPE_LABEL, grade, learnerContent, revealOf, type AnswerKey, type Content, type ItemType } from "./types";
import { activitySelection } from "@/lib/path/path";
import { selectActivities } from "@/lib/path/rules";

/**
 * L6: practice items inside a lesson, for learners. Only PUBLISHED items of a lesson that is published in a live course
 * are ever shown or attempted (teens included); a Draft, approved or rejected item is invisible. Code-graded items are
 * graded at once against the approved answer key and show the correct answer and a cited explanation; they are the only
 * attempts counted toward progress. Feedback-only items are labeled "Practice, not graded": the learner's answer is not
 * stored, and the reveal (a sample answer, key points...) is shown after a try. "Get feedback" uses the Mentor's model
 * on a practice item only, labeled AI feedback, counted against the learner's Mentor allowance (L5); it never grades and
 * never writes the answer for the learner.
 */
type Item = {
  id: string; lesson_id: string; status: string; item_type: ItemType; grading: "code" | "feedback"; level: string; goal: string; interests: string[];
  prompt: string; content: Content; answer_key: AnswerKey; explanation: string; citation: { sourceId: string; title: string; url: string | null; quote?: string };
};
const cite = (c: Item["citation"]) => ({ title: c.title, url: c.url ?? null, quote: c.quote ?? null });

/**
 * L7: which of the lesson's published items this learner sees. With a completed interview and "personal" practice, the
 * items picked for their level, goal and interests (one per idea, at least 3 kinds when the pool has them), each with
 * why; otherwise, or after they switch to the default set, every published item. Never anything unpublished.
 */
export async function shownItems(actor: Account, lessonId: string) {
  const db = getDb();
  const all = (((await db.from("activity_items").select("*").eq("lesson_id", lessonId).eq("status", "published").order("created_at", { ascending: true })).data ?? []) as (Item & { idea_key: string })[])
    .filter((i) => i.status === "published");
  const sel = await activitySelection(actor.id);
  if (!sel || sel.mode === "default" || all.length <= MIN_MODULE_TYPES) {
    return {
      items: all, why: new Map<string, string[]>(),
      selection: { mode: sel?.mode === "default" ? "default" : "all", personalized: false, canPersonalize: !!sel && all.length > MIN_MODULE_TYPES,
        note: sel?.mode === "default" ? "Showing the default set: every reviewed practice item for this lesson." : null },
    };
  }
  const picks = selectActivities(all.map((i) => ({ id: i.id, item_type: i.item_type, level: i.level, goal: i.goal, interests: i.interests ?? [], idea_key: i.idea_key })), sel.answers);
  const why = new Map(picks.map((p) => [p.id, p.why]));
  return {
    items: picks.map((p) => all.find((i) => i.id === p.id)!), why,
    selection: { mode: "personal", personalized: true, canPersonalize: true, note: `Picked ${picks.length} of ${all.length} reviewed items for your goal, level and interests. You can switch to the default set.` },
  };
}

/** The lesson's practice items as a learner sees them (never a key, never a reveal), with their own results and why. */
export async function lessonActivities(actor: Account, lessonId: string) {
  if (!(await publishedVersion(lessonId))) return { activities: [], selection: { mode: "all", personalized: false, canPersonalize: false, note: null } };
  const db = getDb();
  const { items, why, selection } = await shownItems(actor, lessonId);
  const mine = items.length ? (((await db.from("activity_attempts").select("item_id, correct, graded_by, created_at").eq("account_id", actor.id).in("item_id", items.map((i) => i.id))).data ?? []) as
    { item_id: string; correct: boolean | null; graded_by: string; created_at: string }[]) : [];
  return {
    selection,
    activities: items.map((i) => {
      const tries = mine.filter((m) => m.item_id === i.id);
      return {
        id: i.id, type: i.item_type, typeLabel: TYPE_LABEL[i.item_type], graded: i.grading === "code", label: i.grading === "code" ? "Graded" : PRACTICE_LABEL,
        level: i.level, goal: i.goal, interests: i.interests, prompt: i.prompt, content: learnerContent(i.item_type, i.content), why: why.get(i.id) ?? null,
        result: i.grading === "code" ? (tries.length ? { attempts: tries.length, correct: tries.some((t) => t.correct) } : null) : (tries.length ? { attempts: tries.length } : null),
      };
    }),
  };
}

/** Only code-graded attempts count: how many of the graded items shown to the learner they have got right. */
export async function lessonScore(actor: Account, lessonId: string) {
  const db = getDb();
  const items = (await shownItems(actor, lessonId)).items.filter((i) => i.grading === "code");
  if (!items.length) return { graded: 0, correct: 0 };
  const right = ((await db.from("activity_attempts").select("item_id").eq("account_id", actor.id).eq("counted", true).eq("correct", true).in("item_id", items.map((i) => i.id))).data ?? []) as { item_id: string }[];
  return { graded: items.length, correct: new Set(right.map((r) => r.item_id)).size };
}

async function liveItem(id: string): Promise<{ item: Item; versionId: string } | null> {
  if (!isUuid(id)) return null;
  const item = (await getDb().from("activity_items").select("*").eq("id", id).maybeSingle()).data as Item | null;
  if (!item || item.status !== "published") return null;
  const found = await publishedVersion(item.lesson_id);
  return found ? { item, versionId: found.v.id } : null;
}

/** Body: the answer for the type (code-graded), or nothing (practice). Graded at once; only code grading counts. */
export async function attemptItem(actor: Account, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.activity.attempt";
  const live = await liveItem(id);
  if (!live) return refused(404, "No such practice item.", A);
  const { item, versionId } = live;
  const db = getDb();
  if (item.grading === "code") {
    const g = grade(item.item_type, item.answer_key, body.answer);
    if (!g) return refused(400, "Answer the item first.", A);
    const { error } = await db.from("activity_attempts").insert({
      item_id: id, account_id: actor.id, lesson_version_id: versionId, graded_by: "code", correct: g.correct, counted: true, answer: g.answer,
    });
    if (error) throw new Error(`attempt insert failed: ${error.message}`);
    return {
      ok: true,
      body: { graded: true, correct: g.correct, correctAnswer: g.correctAnswer, explanation: item.explanation, citation: cite(item.citation), score: await lessonScore(actor, item.lesson_id) },
      event: noAudit(A),
    };
  }
  // Practice: recorded as tried (for the learner's own list), never graded, the answer never stored.
  const { error } = await db.from("activity_attempts").insert({ item_id: id, account_id: actor.id, lesson_version_id: versionId, graded_by: "none", correct: null, counted: false, answer: null });
  if (error) throw new Error(`attempt insert failed: ${error.message}`);
  return {
    ok: true,
    body: { graded: false, label: PRACTICE_LABEL, reveal: revealOf(item.item_type, item.content), explanation: item.explanation, citation: cite(item.citation) },
    event: noAudit(A),
  };
}
/** Attempts are learner activity, not admin actions: not written to the audit log (counts are in activity_attempts). */
const noAudit = (action: string) => ({ action, result: "Completed" as const, context: "" });

export const FEEDBACK_LABEL = "AI feedback · Practice, not graded";
const FEEDBACK_SYSTEM = [
  "You give brief, kind feedback on a learner's practice answer on a learning platform. This is practice, not a test.",
  "Say what is good, what is missing compared with the key points, and one hint to improve. 2 to 5 sentences.",
  "Never give a score or a grade, never say pass or fail, and never write the full answer for them. Use only the key points",
  "and the source quote given. Don't ask for personal details. Don't describe anything as legally or attorney approved.",
].join("\n");
const FeedbackSchema = z.object({ feedback: z.string() });

/** Body: { answer }. Practice items only; uses the Mentor allowance; never stored, never a grade. */
export async function practiceFeedback(actor: Account, id: string, body: Record<string, unknown>, requestId?: string): Promise<Result> {
  const A = "learn.activity.feedback";
  const live = await liveItem(id);
  if (!live) return refused(404, "No such practice item.", A);
  const { item } = live;
  if (item.grading === "code") return refused(409, "This item is graded by code, against its answer key. AI feedback is for practice items only.", A);
  const raw = typeof body.answer === "string" ? body.answer.trim() : "";
  if (raw.length < 3) return refused(400, "Write your answer first.", A);
  if (raw.length > MAX_MESSAGE_CHARS) return refused(400, `Keep your answer under ${MAX_MESSAGE_CHARS} characters.`, A);
  if (!aiConfigured()) return refused(503, "AI feedback is off right now (AI isn't set up). The practice item and its sample answer work as usual.", A);
  const allowance = await allowanceOf(actor);
  const pause = allowancePause(allowance, actor.isMinor);
  if (pause) return refused(402, pause, A);
  const red = actor.isMinor ? redactPersonalData(raw) : { text: raw, removed: false };
  const signal = safetySignal(red.text);
  if (signal) return { ok: true, body: { label: FEEDBACK_LABEL, feedback: safetyResponse(signal, actor.isMinor), safety: true }, event: noAudit(A) };
  const reveal = revealOf(item.item_type, item.content);
  const meter = { usd: 0 };
  let out: z.infer<typeof FeedbackSchema>;
  try {
    out = await structured("activities.feedback", {
      system: FEEDBACK_SYSTEM,
      cachedContext: [`Practice item (${TYPE_LABEL[item.item_type]}): ${item.prompt}`, `Key points / sample: ${JSON.stringify(reveal)}`, `Why: ${item.explanation}`, `Source quote: ${item.citation.quote ?? ""}`].join("\n"),
      user: `The learner's answer:\n"""\n${red.text}\n"""`, schema: FeedbackSchema, maxTokens: 600, allowPersonal: true, estimateUsd: feedbackEstimate(),
      accountId: actor.id, requestId, meter,
    });
  } catch (err) {
    if (meter.usd > 0) await recordMentorUsage(allowance, { accountId: actor.id, isMinor: actor.isMinor, requestId }, meter.usd);
    if (!(err instanceof AiUnavailable)) throw err;
    if (err.code === "cap_reached") return refused(429, "AI feedback is resting for today: the platform's AI spending limit is reached. The sample answer still shows.", A);
    return refused(err.code === "ai_off" ? 503 : 502, "AI feedback isn't available just now. The sample answer still shows; try again later.", A);
  }
  await recordMentorUsage(allowance, { accountId: actor.id, isMinor: actor.isMinor, requestId }, meter.usd);
  // Belt and braces: a number that reads like a score (7/10, 85%) is removed; this is never a grade.
  const text = out.feedback.replace(/\b\d{1,3}\s*(%|\/\s*\d{1,3}\b)/g, "").replace(/\s{2,}/g, " ").trim().slice(0, 1500);
  return { ok: true, body: { label: FEEDBACK_LABEL, feedback: text, note: red.removed ? "Personal details were removed from your answer before it was sent." : null }, event: noAudit(A) };
}
