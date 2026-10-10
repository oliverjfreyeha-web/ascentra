/**
 * C2: the Notebook's optional AI summaries: off by default; a plain message when AI isn't set up or the platform's
 * spending cap is reached; at most AI_SUMMARY_DAILY_LIMIT a day per learner (counted from ai_calls); only the course's
 * auto-notes are sent, never the learner's own "My ideas" journal or who they are; an answer that reads as an income
 * claim is never shown. The AI call itself is stood in for; the database is the in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, seedFake } from "../support/seed";
import type { Account } from "@/lib/auth";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const ai = vi.hoisted(() => ({ configured: true, sent: [] as { user: string; system: string }[], answer: "- Test summary point." as string | Error }));
vi.mock("@/lib/ai", async () => {
  const real = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return {
    ...real,
    aiConfigured: () => ai.configured,
    structured: async (_purpose: string, o: { user: string; system: string }) => {
      ai.sent.push(o);
      if (ai.answer instanceof Error) throw ai.answer;
      return { summary: ai.answer };
    },
  };
});

import { addIdea, setAiSummaries, summarize } from "@/lib/notebook";
import { AiUnavailable } from "@/lib/ai";
import { AI_SUMMARY_DAILY_LIMIT } from "@/lib/progress/config";

const me = { id: ROLE_ID.learner, roleKey: "learner", isMinor: false, displayName: "Test learner", email: "learner@example.com" } as unknown as Account;
type Db = { data: Record<string, Record<string, unknown>[]> };
const rows = (t: string) => ((fake.db as Db).data[t] ??= []);

beforeEach(() => {
  fake.db = seedFake();
  ai.configured = true;
  ai.sent = [];
  ai.answer = "- Test summary point.";
  rows("notebook_entries").push({ id: "e1", account_id: ROLE_ID.learner, academy_id: "a1", category: "quizzes", importance: "very_important", title: "Test quiz?", note: "Test note: the title tag comes first.", created_at: "2026-10-09T10:00:00Z" });
});

describe("Notebook AI summaries", () => {
  it("are off by default and say so", async () => {
    const r = await summarize(me);
    expect(r).toMatchObject({ ok: false, status: 409, reason: expect.stringMatching(/off/) });
    expect(ai.sent).toHaveLength(0);
  });

  it("say plainly when AI isn't set up", async () => {
    await setAiSummaries(me, { on: true });
    ai.configured = false;
    expect(await summarize(me)).toMatchObject({ ok: false, status: 503 });
  });

  it("send only the auto-notes, never the journal or the learner's name or email", async () => {
    await setAiSummaries(me, { on: true });
    await addIdea(me, { body: "Secret journal idea: my plan" });
    expect(await summarize(me)).toMatchObject({ ok: true, body: { summary: "- Test summary point.", label: "AI summary of your auto-notes" } });
    const sent = ai.sent[0].user;
    expect(sent).toContain("Test note: the title tag comes first.");
    expect(sent).not.toContain("Secret journal idea");
    expect(sent).not.toContain("Test learner");
    expect(sent).not.toContain("learner@example.com");
  });

  it(`stop at ${AI_SUMMARY_DAILY_LIMIT} a day per learner (from ai_calls)`, async () => {
    await setAiSummaries(me, { on: true });
    for (let i = 0; i < AI_SUMMARY_DAILY_LIMIT; i++) rows("ai_calls").push({ id: `c${i}`, account_id: ROLE_ID.learner, purpose: "notebook.summary", status: "ok", created_at: new Date().toISOString() });
    expect(await summarize(me)).toMatchObject({ ok: false, status: 429, reason: `You've used today's ${AI_SUMMARY_DAILY_LIMIT} summaries. Try again tomorrow.` });
    // Yesterday's don't count.
    rows("ai_calls").forEach((c) => { c.created_at = new Date(Date.now() - 30 * 3_600_000).toISOString(); });
    expect(await summarize(me)).toMatchObject({ ok: true });
  });

  it("give a plain message when the platform's spending cap is reached", async () => {
    await setAiSummaries(me, { on: true });
    ai.answer = new AiUnavailable("cap_reached", "cap");
    expect(await summarize(me)).toMatchObject({ ok: false, status: 429, reason: expect.stringMatching(/spending limit is reached/) });
  });

  it("never show a summary that reads as an income claim", async () => {
    await setAiSummaries(me, { on: true });
    ai.answer = "- With this you will earn $5,000 a month.";
    expect(await summarize(me)).toMatchObject({ ok: false, status: 502, reason: expect.stringMatching(/income-claims check/) });
  });
});
