import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AiUnavailable, aiConfigured, structured } from "@/lib/ai";
import { estimateUsd } from "@/lib/ai/config";
import { isUuid, refused, type Result } from "@/lib/courses/common";
import { findIncomeClaims } from "@/lib/courses/income";
import { AI_SUMMARY_DAILY_LIMIT, IMPORTANCE, NOTEBOOK_CATEGORIES, type Importance, type NotebookCategory } from "@/lib/progress/config";

/**
 * C2: the Notebook, private to the learner.
 *   Auto-notes: when the learner finishes a "Very important" item, its Notebook note (2 or 3 sentences from the course)
 *   is added, filed by category (videos, assignments, tasks, quizzes, key terms) with its label and course. No AI.
 *   "My ideas": the learner's own journal, kept apart from the auto-notes and never shown to anyone else.
 *   AI summaries (optional, off by default): a summary of the auto-notes only (course text, never the journal and never
 *   who the learner is), through the existing AI path and its spend caps, at most AI_SUMMARY_DAILY_LIMIT a day each,
 *   logged in ai_calls.
 * Everything is read and written by the API for the learner who owns it; no one reads these rows directly.
 */

type Entry = { id: string; academy_id: string; category: NotebookCategory; importance: Importance; title: string; note: string; created_at: string };
type Idea = { id: string; body: string; created_at: string; updated_at: string };

export async function notebook(actor: Account) {
  const db = getDb();
  const entries = (((await db.from("notebook_entries").select("id, academy_id, category, importance, title, note, created_at").eq("account_id", actor.id)).data ?? []) as Entry[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const academies = entries.length ? (((await db.from("academies").select("id, name").in("id", [...new Set(entries.map((e) => e.academy_id))])).data ?? []) as { id: string; name: string }[]) : [];
  const ideas = (((await db.from("notes").select("id, body, created_at, updated_at, kind").eq("account_id", actor.id).eq("kind", "idea")).data ?? []) as Idea[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const settings = (await db.from("profiles").select("notebook_ai_summaries").eq("account_id", actor.id).maybeSingle()).data as { notebook_ai_summaries: boolean } | null;
  return {
    categories: Object.entries(NOTEBOOK_CATEGORIES).map(([key, label]) => ({
      key, label,
      entries: entries.filter((e) => e.category === key).map((e) => ({
        id: e.id, title: e.title, note: e.note, importance: e.importance, importanceLabel: IMPORTANCE[e.importance].label,
        course: academies.find((a) => a.id === e.academy_id)?.name ?? "A course", at: e.created_at,
      })),
    })),
    ideas: ideas.map((i) => ({ id: i.id, body: i.body, at: i.created_at, updatedAt: i.updated_at })),
    ai: { on: settings?.notebook_ai_summaries === true, available: aiConfigured(), dailyLimit: AI_SUMMARY_DAILY_LIMIT },
    note: "Your Notebook is private. Auto-notes come from \"Very important\" items you finish. \"My ideas\" is yours alone.",
  };
}

const ideaText = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 5000) : "");

/** Body: { body }. A new idea in the learner's own journal. Not audited: it's the learner's private writing. */
export async function addIdea(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "notebook.idea";
  const text = ideaText(body.body);
  if (!text) return refused(400, "Write something first.", A);
  const { error } = await getDb().from("notes").insert({ account_id: actor.id, kind: "idea", body: text });
  if (error) throw new Error(`idea save failed: ${error.message}`);
  return { ok: true, status: 201, body: await notebook(actor), event: { action: A, result: "Completed", context: "" } };
}

export async function editIdea(actor: Account, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "notebook.idea";
  if (!isUuid(id)) return refused(404, "No such idea.", A);
  const text = ideaText(body.body);
  if (!text) return refused(400, "Write something first.", A);
  const db = getDb();
  const row = (await db.from("notes").select("id, account_id, kind").eq("id", id).maybeSingle()).data as { account_id: string; kind: string } | null;
  if (!row || row.account_id !== actor.id || row.kind !== "idea") return refused(404, "No such idea.", A);
  const { error } = await db.from("notes").update({ body: text }).eq("id", id);
  if (error) throw new Error(`idea save failed: ${error.message}`);
  return { ok: true, body: await notebook(actor), event: { action: A, result: "Completed", context: "" } };
}

export async function deleteIdea(actor: Account, id: string): Promise<Result> {
  const A = "notebook.idea";
  if (!isUuid(id)) return refused(404, "No such idea.", A);
  const db = getDb();
  const row = (await db.from("notes").select("id, account_id, kind").eq("id", id).maybeSingle()).data as { account_id: string; kind: string } | null;
  if (!row || row.account_id !== actor.id || row.kind !== "idea") return refused(404, "No such idea.", A);
  const { error } = await db.from("notes").delete().eq("id", id);
  if (error) throw new Error(`idea delete failed: ${error.message}`);
  return { ok: true, body: await notebook(actor), event: { action: A, result: "Completed", context: "" } };
}

/** Body: { on }. Turns the optional AI summaries on or off (off by default). */
export async function setAiSummaries(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "notebook.ai_setting";
  if (typeof body.on !== "boolean") return refused(400, "Turn it on or off.", A);
  const { error } = await getDb().from("profiles").update({ notebook_ai_summaries: body.on }).eq("account_id", actor.id);
  if (error) throw new Error(`setting failed: ${error.message}`);
  return {
    ok: true, body: await notebook(actor),
    event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: body.on ? "off" : "on", next: body.on ? "on" : "off", context: `Turned ${body.on ? "on" : "off"} AI summaries of their Notebook (only the course auto-notes are sent).` },
  };
}

const SummarySchema = z.object({ summary: z.string() });
export const SUMMARY_SYSTEM = [
  "You summarize a learner's study notes from an online course, so they can review them quickly.",
  "Group the main ideas in 3 to 8 short bullet points, in plain words, using only the notes given.",
  "Never promise or imply income, earnings or results. Never describe anything as legally or attorney approved.",
].join("\n");

/** A summary of the learner's auto-notes. Off unless turned on; limited per day; the spend caps apply. */
export async function summarize(actor: Account, requestId?: string): Promise<Result> {
  const A = "notebook.summary";
  const db = getDb();
  const settings = (await db.from("profiles").select("notebook_ai_summaries").eq("account_id", actor.id).maybeSingle()).data as { notebook_ai_summaries: boolean } | null;
  if (settings?.notebook_ai_summaries !== true) return refused(409, "AI summaries are off. Turn them on in your Notebook first.", A);
  if (!aiConfigured()) return refused(503, "AI summaries aren't available right now (AI isn't set up). Your notes are all here.", A);
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const used = ((await db.from("ai_calls").select("id, created_at, purpose, status").eq("account_id", actor.id).eq("purpose", "notebook.summary").gte("created_at", since)).data ?? []) as { status: string }[];
  if (used.filter((u) => u.status === "ok").length >= AI_SUMMARY_DAILY_LIMIT) return refused(429, `You've used today's ${AI_SUMMARY_DAILY_LIMIT} summaries. Try again tomorrow.`, A);
  const entries = ((await db.from("notebook_entries").select("title, note, category").eq("account_id", actor.id)).data ?? []) as { title: string; note: string; category: string }[];
  if (!entries.length) return refused(409, "Your Notebook has no auto-notes yet. Finish a \"Very important\" item first.", A);
  // Only course text: the notes' titles and texts. Never the journal, never a name or an email.
  const text = entries.slice(0, 60).map((e) => `- [${e.category}] ${e.title}: ${e.note}`).join("\n").slice(0, 12_000);
  let out: z.infer<typeof SummarySchema>;
  try {
    out = await structured("notebook.summary", { system: SUMMARY_SYSTEM, user: `The notes:\n${text}`, schema: SummarySchema, maxTokens: 800, estimateUsd: estimateUsd("notebookSummary"), accountId: actor.id, requestId });
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    if (err.code === "cap_reached") return refused(429, "AI summaries are resting for today: the platform's AI spending limit is reached. Your notes are all here.", A);
    return refused(err.code === "ai_off" ? 503 : 502, "AI summaries aren't available just now. Try again later.", A);
  }
  const summary = out.summary.slice(0, 3000);
  // Belt and braces: the summary is checked like any course text.
  if (findIncomeClaims(summary).length) return refused(502, "The summary couldn't be shown (it didn't pass the income-claims check). Your notes are all here.", A);
  return { ok: true, body: { summary, label: "AI summary of your auto-notes" }, event: { action: A, result: "Completed", context: "" } };
}
