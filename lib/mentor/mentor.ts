import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { actorOf } from "@/lib/auth/require-cap";
import { AiUnavailable, aiConfigured, embed, structured } from "@/lib/ai";
import { mentorEstimate } from "@/lib/ai/config";
import { tierOf } from "@/lib/billing";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { isUuid, refused, type Result } from "@/lib/courses/common";
import type { Citation, LessonBody } from "@/lib/courses/lessons";
import {
  GRADED_REFUSAL, GUARDIAN_POLICY_LABEL, GUARDIAN_SAFETY_ALERT_POLICY, MAX_MESSAGE_CHARS, NOT_IN_SOURCES, OFF_TOPIC_ADULT, OFF_TOPIC_TEEN, PAUSED,
  PERSONAL_DATA_NOTE, CATEGORY_LABEL, isGradedRequest, mentorDailyCap, redactPersonalData, safetyPriority, safetyResponse, safetySignal, type SafetyCategory,
} from "./rules";

/**
 * L4: the Mentor. On a published lesson, a learner asks; the Mentor answers only within that lesson's course, from the
 * course's approved sources (L1 retrieval) and the lesson itself, citing what it draws on. When nothing supports an
 * answer it says so instead of guessing. It won't do graded work. Every message and every reply is safety-checked
 * (a fixed signal check, then Claude Haiku 4.5 as a screen); a safety concern gets the safety response and a
 * SafetyEvent for the review queue (a teen's first). Teens (accounts.is_minor): stricter rules, personal details
 * removed, off-topic redirected. Basic (and the trial) covers one subject; Pro any course. A daily message cap and the
 * L1 spend caps apply.
 * The conversation text is stored ONLY in the learner's private mentor_threads row. The AI call log has counts and
 * cost only; the audit log and safety events never hold what was written.
 */
const A = "mentor.message";
const MAX_THREAD_MESSAGES = 200;
const HISTORY_TURNS = 6;

export type MentorMessage = {
  role: "learner" | "mentor"; text: string; at: string;
  kind?: "answer" | "not_in_sources" | "graded_refusal" | "off_topic" | "safety" | "paused";
  citations?: { ref: number; sourceId: string; title: string; url: string | null }[];
  note?: string | null;
};
type Thread = { id: string; account_id: string; lesson_id: string | null; course_id: string | null; academy_id: string | null; title: string | null; status: string; messages: MentorMessage[]; message_count: number; last_message_at: string | null; created_at: string };

const SCREEN_SYSTEM = [
  "You screen text in a learning platform's course Mentor. Classify it; don't answer it.",
  "category: any safety concern (self_harm, abuse, threat, sexual_content, violence, hate, other_harm), or none.",
  "gradedWork: true if it asks for (or, for a reply, provides) a finished answer to an assessment, assignment, quiz, lab, test or capstone, rather than an explanation or a hint.",
  "onTopic: true if it is about the course's subject or about learning it.",
  "asksPersonalData: true if it asks for someone's personal details (name, age, school, location, contact details, photos).",
].join("\n");
const ScreenSchema = z.object({
  category: z.enum(["none", "self_harm", "abuse", "threat", "sexual_content", "violence", "hate", "other_harm"]),
  gradedWork: z.boolean(), onTopic: z.boolean(), asksPersonalData: z.boolean(),
});
type Screen = z.infer<typeof ScreenSchema>;

export const MENTOR_SYSTEM = [
  "You are ASCENTRA's Mentor for one course. Answer only from the numbered passages you are given (the course's approved sources",
  "and the current lesson), and list the numbers of the passages your answer rests on.",
  "- If the passages don't support an answer, set kind to not_in_sources and say so in one sentence. Don't guess or use outside knowledge.",
  "- Never write or complete graded work (an assessment, assignment, quiz, lab, test or capstone answer). Explain the idea, give one hint, or",
  "  ask a guiding question instead, and set kind to graded_refusal.",
  "- If the question isn't about the course, set kind to off_topic.",
  "- Be clear and brief: under 180 words. Paraphrase; quote at most a short phrase. Never describe anything as legally or attorney approved.",
].join("\n");
export const TEEN_RULES = [
  "The learner is a teen (14 to 17). Use age-appropriate language and examples. Never ask for or repeat personal information",
  "(name, age, school, location, contact details, photos). Stay on the course; if asked about anything else, steer back to the lesson kindly.",
].join("\n");
const AnswerSchema = z.object({ kind: z.enum(["answer", "not_in_sources", "graded_refusal", "off_topic"]), text: z.string(), passages: z.array(z.number().int()) });

type Passage = { n: number; sourceId: string; title: string; url: string | null; text: string };
type LessonCtx = { lessonId: string; title: string; versionId: string; courseId: string; academy: { id: string; slug: string; name: string }; body: LessonBody; citations: Citation[] };

/** The published lesson the learner is on, and its live course (never a Draft or a version in Review). */
async function lessonContext(lessonId: string): Promise<LessonCtx | null> {
  if (!isUuid(lessonId)) return null;
  const db = getDb();
  const v = (((await db.from("lesson_versions").select("id, lesson_id, course_id, title, body, citations, status").eq("lesson_id", lessonId).eq("status", "published").limit(1)).data ?? []) as
    { id: string; lesson_id: string; course_id: string; title: string; body: LessonBody; citations: Citation[]; status: string }[])[0];
  if (!v) return null;
  const course = (await db.from("courses").select("academy_id, status").eq("id", v.course_id).maybeSingle()).data as { academy_id: string; status: string } | null;
  if (!course || (course.status !== "published" && course.status !== "restored")) return null;
  const academy = (await db.from("academies").select("id, slug, name").eq("id", course.academy_id).maybeSingle()).data as LessonCtx["academy"] | null;
  if (!academy || academy.slug === OWNER_ACADEMY_SLUG) return null;
  return { lessonId, title: v.title, versionId: v.id, courseId: v.course_id, academy, body: v.body, citations: v.citations };
}

/** The course's sources: everything its published lessons cite and its Blueprint was built from. */
async function courseSourceIds(ctx: LessonCtx): Promise<Set<string>> {
  const db = getDb();
  const versions = ((await db.from("lesson_versions").select("citations").eq("course_id", ctx.courseId).eq("status", "published")).data ?? []) as { citations: Citation[] }[];
  const bp = ((await db.from("academy_blueprints").select("source_ids").eq("course_id", ctx.courseId)).data ?? []) as { source_ids: string[] }[];
  return new Set([...versions.flatMap((v) => v.citations.map((c) => c.sourceId)), ...bp.flatMap((b) => b.source_ids ?? [])]);
}

/** Numbered passages: the lesson's cited paragraphs first, then the best matches from the course's approved sources. */
async function passagesFor(ctx: LessonCtx, question: string, who: { accountId: string }): Promise<Passage[]> {
  const out: Passage[] = [];
  const cite = (ref: number) => ctx.citations.find((c) => c.ref === ref);
  for (const p of [...ctx.body.sections.flatMap((s) => s.paragraphs), ...ctx.body.takeaways]) {
    const c = p.refs.map(cite).find((x): x is Citation => !!x);
    if (c && out.length < 12) out.push({ n: out.length + 1, sourceId: c.sourceId, title: c.title, url: c.url, text: p.text });
  }
  const allowed = await courseSourceIds(ctx);
  let vector: number[] | null = null;
  try {
    vector = (await embed([question.slice(0, 500)], "query", who))?.[0] ?? null;
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
  }
  const { data, error } = await getDb().rpc("match_source_chunks", { p_query: question.slice(0, 500), p_embedding: vector ? `[${vector.join(",")}]` : null, p_limit: 40 });
  if (error) throw new Error(`mentor retrieval failed: ${error.message}`);
  for (const r of ((data ?? []) as { source_id: string; title: string; url: string | null; content: string }[]).filter((r) => allowed.has(r.source_id)).slice(0, 8)) {
    out.push({ n: out.length + 1, sourceId: r.source_id, title: r.title, url: r.url, text: r.content.slice(0, 900) });
  }
  return out;
}

async function screen(text: string, ctx: LessonCtx, isMinor: boolean, kind: "message" | "reply", who: { accountId: string; requestId?: string }): Promise<Screen> {
  return structured("mentor.screen", {
    system: SCREEN_SYSTEM,
    user: `Course: ${ctx.academy.name}\nLesson: ${ctx.title}\nLearner: ${isMinor ? "a teen" : "an adult"}\nThis is the learner's ${kind === "message" ? "message to" : "reply from"} the Mentor:\n"""\n${text}\n"""`,
    schema: ScreenSchema, maxTokens: 300, allowPersonal: true, estimateUsd: kind === "message" ? mentorEstimate() : 0, accountId: who.accountId, requestId: who.requestId,
  });
}

/** Records a SafetyEvent for the review queue: the category and what was done, never what was written. */
async function recordSafety(actor: Account, category: SafetyCategory, stage: "input" | "output", threadId: string | null, requestId?: string) {
  const { priority, severity } = safetyPriority(category, actor.isMinor);
  const actions = ["Safety response shown", ...(actor.isMinor ? ["Conversation paused"] : []),
    actor.isMinor ? `Guardian alert: ${GUARDIAN_SAFETY_ALERT_POLICY === "none" ? "not sent (policy placeholder)" : "limited alert (policy)"}` : null].filter((x): x is string => !!x);
  const { error } = await getDb().from("safety_events").insert({
    subject_account_id: actor.id, category, severity, priority, is_minor: actor.isMinor === true, stage, status: "open", source: "mentor", thread_id: threadId,
    reason: `${CATEGORY_LABEL[category]} signal in ${actor.isMinor ? "a teen's" : "an adult's"} Mentor ${stage === "input" ? "message" : "reply"}.`,
    actions_taken: actions, guardian_policy: actor.isMinor ? GUARDIAN_POLICY_LABEL : null,
  });
  if (error) throw new Error(`safety event insert failed: ${error.message}`);
  await recordAudit({
    actor: actorOf(actor), action: "safety.event", result: "Completed", status: severity === "urgent" ? "Urgent review" : "Recorded", requestId,
    target: { type: "account", id: actor.id }, context: `Safety check (${stage}): ${CATEGORY_LABEL[category]}. ${actions.join("; ")}. No message text is recorded.`,
  });
}

async function threadFor(actor: Account, ctx: LessonCtx, threadId: unknown): Promise<Thread | null> {
  const db = getDb();
  if (isUuid(threadId)) {
    const t = (await db.from("mentor_threads").select("*").eq("id", threadId).maybeSingle()).data as Thread | null;
    return t && t.account_id === actor.id && t.lesson_id === ctx.lessonId ? t : null;
  }
  return null;
}

/** Basic and the trial: one subject (the course of the learner's first Mentor conversation). Pro and the Owner: any course. */
async function planAllows(actor: Account, ctx: LessonCtx): Promise<string | null> {
  const { tier } = await tierOf(actor);
  if (tier === "none") return "The Mentor is part of the Basic and Pro plans (and the free trial).";
  if (tier === "pro" || tier === "full") return null;
  const first = (((await getDb().from("mentor_threads").select("academy_id, created_at").eq("account_id", actor.id).order("created_at", { ascending: true }).limit(1)).data ?? []) as { academy_id: string | null }[])[0];
  if (!first?.academy_id || first.academy_id === ctx.academy.id) return null;
  const name = ((await getDb().from("academies").select("name").eq("id", first.academy_id).maybeSingle()).data as { name: string } | null)?.name ?? "your first subject";
  return `Your plan's Mentor covers one subject: ${name}. Pro adds more subjects.`;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Body: { lessonId, message, threadId? }. */
export async function askMentor(actor: Account, body: Record<string, unknown>, requestId?: string): Promise<Result> {
  const raw = typeof body.message === "string" ? body.message.replace(/\s+$/g, "").trim() : "";
  if (!raw) return refused(400, "Write your question.", A);
  if (raw.length > MAX_MESSAGE_CHARS) return refused(400, `Keep your question under ${MAX_MESSAGE_CHARS} characters.`, A);
  if (!aiConfigured()) return refused(503, "The Mentor is off right now (AI isn't set up). Your lessons work as usual.", A);
  const ctx = await lessonContext(String(body.lessonId ?? ""));
  if (!ctx) return refused(404, "The Mentor works on a published lesson. Open one and ask there.", A);
  const blocked = await planAllows(actor, ctx);
  if (blocked) return refused(403, blocked, A);
  const db = getDb();
  const cap = mentorDailyCap();
  const used = (((await db.from("mentor_daily_usage").select("messages").eq("account_id", actor.id).eq("day", today()).limit(1)).data ?? []) as { messages: number }[])[0]?.messages ?? 0;
  if (used >= cap) return refused(429, `You've reached today's Mentor limit (${cap} messages). It resets at midnight UTC. Your lessons work as usual.`, A);

  let thread = await threadFor(actor, ctx, body.threadId);
  if (thread?.status === "paused") {
    return { ok: true, body: { thread: { id: thread.id, status: thread.status }, reply: { role: "mentor", kind: "paused", text: PAUSED, at: new Date().toISOString() } }, event: noAudit() };
  }
  if (thread && thread.message_count >= MAX_THREAD_MESSAGES) thread = null;

  // Teens: personal details never leave this function.
  const red = actor.isMinor ? redactPersonalData(raw) : { text: raw, removed: false };
  const message = red.text;
  const who = { accountId: actor.id, requestId };
  const now = () => new Date().toISOString();
  let reply: MentorMessage | null = null;
  let safety: { category: SafetyCategory; stage: "input" | "output" } | null = null;

  try {
    const signal = safetySignal(message);
    if (signal) {
      safety = { category: signal, stage: "input" };
    } else if (isGradedRequest(message)) {
      reply = { role: "mentor", kind: "graded_refusal", text: GRADED_REFUSAL, at: now() };
    } else {
      const s = await screen(message, ctx, actor.isMinor, "message", who);
      if (s.category !== "none") safety = { category: s.category, stage: "input" };
      else if (s.gradedWork) reply = { role: "mentor", kind: "graded_refusal", text: GRADED_REFUSAL, at: now() };
      else if (!s.onTopic) reply = { role: "mentor", kind: "off_topic", text: actor.isMinor ? OFF_TOPIC_TEEN : OFF_TOPIC_ADULT, at: now() };
    }
    if (!safety && !reply) {
      const passages = await passagesFor(ctx, message, who);
      if (!passages.length) {
        reply = { role: "mentor", kind: "not_in_sources", text: NOT_IN_SOURCES, at: now() };
      } else {
        const history = (thread?.messages ?? []).filter((m) => m.kind !== "safety").slice(-HISTORY_TURNS * 2)
          .map((m) => ({ role: m.role === "learner" ? ("user" as const) : ("assistant" as const), content: m.text }));
        const a = await structured("mentor.answer", {
          system: actor.isMinor ? `${MENTOR_SYSTEM}\n${TEEN_RULES}` : MENTOR_SYSTEM,
          history: alternate(history),
          user: [`Course: ${ctx.academy.name}. Lesson: ${ctx.title}.`, "Passages:", ...passages.map((p) => `P${p.n} [${p.title}]: ${p.text}`), "", `Question: ${message}`].join("\n"),
          schema: AnswerSchema, maxTokens: 1200, allowPersonal: true, accountId: actor.id, requestId,
        });
        const used = [...new Set(a.passages)].map((n) => passages.find((p) => p.n === n)).filter((p): p is Passage => !!p);
        const sources = [...new Map(used.map((p) => [p.sourceId, p])).values()];
        if (a.kind === "answer" && sources.length) {
          reply = {
            role: "mentor", kind: "answer", text: a.text.replace(/\s*[[(]P\d+(?:\s*[,;]\s*P?\d+)*[\])]/g, "").trim().slice(0, 2000), at: now(),
            citations: sources.map((p, i) => ({ ref: i + 1, sourceId: p.sourceId, title: p.title, url: p.url })),
          };
        } else if (a.kind === "graded_refusal") {
          reply = { role: "mentor", kind: "graded_refusal", text: `${a.text.trim().slice(0, 1200)}`.trim() || GRADED_REFUSAL, at: now() };
        } else if (a.kind === "off_topic") {
          reply = { role: "mentor", kind: "off_topic", text: actor.isMinor ? OFF_TOPIC_TEEN : OFF_TOPIC_ADULT, at: now() };
        } else {
          // An "answer" with nothing cited is treated as not supported: the Mentor doesn't guess.
          reply = { role: "mentor", kind: "not_in_sources", text: NOT_IN_SOURCES, at: now() };
        }
        // The reply is checked too before anyone sees it.
        if (reply.kind === "answer" || reply.kind === "graded_refusal") {
          const out = await screen(reply.text, ctx, actor.isMinor, "reply", who);
          if (out.category !== "none") safety = { category: out.category, stage: "output" };
          else if (out.gradedWork) reply = { role: "mentor", kind: "graded_refusal", text: GRADED_REFUSAL, at: now() };
          else if (out.asksPersonalData && actor.isMinor) reply = { role: "mentor", kind: "off_topic", text: OFF_TOPIC_TEEN, at: now() };
        }
      }
    }
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    if (err.code === "cap_reached") return refused(429, "The Mentor is resting for today: the platform's AI spending limit is reached. Your lessons work as usual.", A);
    if (err.code === "ai_off") return refused(503, "The Mentor is off right now (AI isn't set up). Your lessons work as usual.", A);
    return refused(502, "The Mentor couldn't answer just now. Nothing was saved; try again.", A);
  }
  if (safety) reply = { role: "mentor", kind: "safety", text: safetyResponse(safety.category, actor.isMinor), at: now() };
  if (red.removed) reply!.note = PERSONAL_DATA_NOTE;

  // Store the exchange in the learner's private thread (the only place the text is kept), then count the message.
  const learnerMsg: MentorMessage = { role: "learner", text: message, at: now() };
  const pause = !!safety && actor.isMinor;
  if (thread) {
    const messages = [...thread.messages, learnerMsg, reply!];
    const { error } = await db.from("mentor_threads").update({ messages, message_count: messages.length, last_message_at: reply!.at, status: pause ? "paused" : thread.status }).eq("id", thread.id);
    if (error) throw new Error(`mentor thread update failed: ${error.message}`);
    thread = { ...thread, messages, status: pause ? "paused" : thread.status };
  } else {
    const ins = await db.from("mentor_threads").insert({
      account_id: actor.id, academy_id: ctx.academy.id, course_id: ctx.courseId, lesson_id: ctx.lessonId, context: "lesson",
      title: (safety ? "Conversation" : message).slice(0, 80), status: pause ? "paused" : "open", messages: [learnerMsg, reply!], message_count: 2, last_message_at: reply!.at,
      retention_class: "user_content",
    }).select("*").single();
    if (ins.error) throw new Error(`mentor thread insert failed: ${ins.error.message}`);
    thread = ins.data as Thread;
  }
  await db.rpc("count_mentor_message", { p_account: actor.id, p_day: today() });
  if (safety) await recordSafety(actor, safety.category, safety.stage, thread.id, requestId);
  return { ok: true, body: { thread: { id: thread.id, status: thread.status, title: thread.title }, reply: reply! }, event: noAudit() };
}

/** Mentor messages aren't audited: the audit log never holds Mentor content. */
const noAudit = () => ({ action: A, result: "Completed" as const, context: "" });

/** The conversation must alternate user/assistant for the API: merge neighbours of the same role. */
function alternate(h: { role: "user" | "assistant"; content: string }[]) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of h) {
    if (!out.length && m.role === "assistant") continue;
    if (out.at(-1)?.role === m.role) out[out.length - 1] = { role: m.role, content: `${out.at(-1)!.content}\n\n${m.content}` };
    else out.push(m);
  }
  if (out.at(-1)?.role === "user") out.pop();
  return out;
}

// ============ The learner's own threads ============

export async function listThreads(actor: Account, lessonId: string | null) {
  let q = getDb().from("mentor_threads").select("id, lesson_id, title, status, message_count, last_message_at, created_at").eq("account_id", actor.id);
  if (lessonId && isUuid(lessonId)) q = q.eq("lesson_id", lessonId);
  const rows = ((await q.order("created_at", { ascending: false }).limit(50)).data ?? []) as Omit<Thread, "messages" | "account_id" | "course_id" | "academy_id">[];
  return rows.map((t) => ({ id: t.id, lessonId: t.lesson_id, title: t.title, status: t.status, messages: t.message_count, lastMessageAt: t.last_message_at, createdAt: t.created_at }));
}

/** Only the learner's own thread; anyone else gets "not found", whatever their role. */
export async function getThread(actor: Account, id: string) {
  if (!isUuid(id)) return null;
  const t = (await getDb().from("mentor_threads").select("*").eq("id", id).maybeSingle()).data as Thread | null;
  if (!t || t.account_id !== actor.id) return null;
  return { id: t.id, lessonId: t.lesson_id, title: t.title, status: t.status, messages: t.messages, createdAt: t.created_at };
}

/** A learner deletes one of their threads, or all of them. Audited without content. */
export async function deleteThreads(actor: Account, id: string | null): Promise<Result> {
  const A2 = "mentor.threads.delete";
  const db = getDb();
  if (id !== null) {
    const t = isUuid(id) ? ((await db.from("mentor_threads").select("id, account_id").eq("id", id).maybeSingle()).data as { id: string; account_id: string } | null) : null;
    if (!t || t.account_id !== actor.id) return refused(404, "No such conversation of yours.", A2);
    const { error } = await db.from("mentor_threads").delete().eq("id", id);
    if (error) throw new Error(`thread delete failed: ${error.message}`);
    return { ok: true, body: { deleted: 1 }, event: { action: A2, result: "Completed", target: { type: "account", id: actor.id }, context: "Deleted one of their Mentor conversations." } };
  }
  const mine = ((await db.from("mentor_threads").select("id").eq("account_id", actor.id)).data ?? []) as { id: string }[];
  if (mine.length) {
    const { error } = await db.from("mentor_threads").delete().eq("account_id", actor.id);
    if (error) throw new Error(`thread delete failed: ${error.message}`);
  }
  return { ok: true, body: { deleted: mine.length }, event: { action: A2, result: "Completed", target: { type: "account", id: actor.id }, context: `Deleted all of their Mentor conversations (${mine.length}).` } };
}

export const mentorInfo = () => ({ aiOn: aiConfigured(), dailyCap: mentorDailyCap() });
