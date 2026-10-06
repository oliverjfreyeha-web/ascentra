/**
 * L6: the activity library through the real routes (database faked in memory, Clerk mocked, the Anthropic SDK
 * replaced). AI drafts a lesson's pool from approved sources, every item cited and entering as Draft; a Reviewer edits,
 * approves or rejects; a module publishes only with 3+ activity types; learners see only published items; code-graded
 * items are graded at once with the correct answer and a cited explanation and are the only ones counted; practice
 * items are labeled "Practice, not graded", their answers never stored; AI feedback uses the Mentor allowance and never
 * grades; Reviewers see common misses without names; a refresh drafts new items with a diff. Every page reader is run
 * against the real responses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, passagesMatching, promptText } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l6", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as libraryRoute from "@/app/api/v1/courses/[slug]/activities/route";
import * as itemRoute from "@/app/api/v1/courses/[slug]/activities/[id]/route";
import * as reviewRoute from "@/app/api/v1/courses/[slug]/activities/[id]/review/route";
import * as draftRoute from "@/app/api/v1/courses/[slug]/lessons/[id]/activities/route";
import * as missesRoute from "@/app/api/v1/courses/[slug]/lessons/[id]/misses/route";
import * as publishRoute from "@/app/api/v1/courses/[slug]/modules/[id]/activities/publish/route";
import * as attemptRoute from "@/app/api/v1/learn/activities/[id]/attempt/route";
import * as feedbackRoute from "@/app/api/v1/learn/activities/[id]/feedback/route";
import * as lessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import { checkItem, grade, learnerContent, seededOrder } from "@/lib/activities/types";
import { toPoolItems, type Pool } from "@/lib/activities/draft";
import {
  attemptFrom, feedbackFrom, itemStatusFrom, lessonActivitiesFrom, libraryFrom, missesFrom, modulePublishedFrom, poolDraftedFrom,
} from "@/app/activities-api";

type Db = ReturnType<typeof seedFake>;
let db: Db;
let lessonId = "";
let moduleId = "";
const SLUG = "mkt";
const usage = { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

async function seedCourse() {
  db.data.sources = [{ id: "s-speed", title: "Speed to lead study", url: "https://example.org/speed", status: "approved", academy_id: null, license_class: "open", last_checked_at: "2026-09-01" }];
  await db.client.rpc("put_source_chunks", { p_source: "s-speed", p_chunks: [{ position: 0, text: "Respond to new leads within five minutes. Leads cool quickly after the first hour." }] });
  const a = (await db.client.from("academies").insert({ slug: SLUG, name: "Client Acquisition Systems" }).select("id").single()).data as { id: string };
  const c = (await db.client.from("courses").insert({ academy_id: a.id, version: 1, status: "published" }).select("id").single()).data as { id: string };
  const m = (await db.client.from("modules").insert({ course_id: c.id, position: 1, code: "m1", title: "Lead response" }).select("id").single()).data as { id: string };
  moduleId = m.id;
  const l = (await db.client.from("lessons").insert({ module_id: m.id, position: 1, title: "Why minutes matter", objectives: ["Reply fast"], content: {} }).select("id").single()).data as { id: string };
  lessonId = l.id;
  await db.client.from("lesson_versions").insert({
    lesson_id: l.id, course_id: c.id, version: 1, status: "published", title: "Why minutes matter", published_at: "2026-09-01",
    body: { summary: "Speed wins.", sections: [{ heading: "Speed", paragraphs: [{ text: "Reply to new leads within five minutes.", refs: [1] }] }], takeaways: [] },
    citations: [{ ref: 1, sourceId: "s-speed", title: "Speed to lead study", url: "https://example.org/speed", license: "open", lastChecked: "2026-09-01" }],
  });
}

/** A model answer citing the passage about five minutes. */
function pool(passage: number, types: string[] = ["multiple_choice", "true_false", "short_answer", "ordering"]): Pool {
  const base = { level: "beginner" as const, goal: "Reply to leads fast", interests: ["Home services"], passage, explanation: "The study says to respond within five minutes." };
  const all: Record<string, Pool["items"][number]> = {
    multiple_choice: { ...base, type: "multiple_choice", ideaKey: "reply-speed", prompt: "How fast should you reply to a new lead?", options: ["Within five minutes", "Next day", "Next week"], correctIndex: 0 },
    true_false: { ...base, type: "true_false", ideaKey: "reply-speed-tf", prompt: "Leads stay warm for days.", correctBool: false, level: "intermediate" },
    short_answer: { ...base, type: "short_answer", ideaKey: "why-speed", prompt: "Why does speed matter?", sampleAnswer: "Leads cool quickly, so the first useful reply often wins." },
    ordering: { ...base, type: "ordering", ideaKey: "response-steps", prompt: "Put the steps in order.", steps: ["Route the lead", "Reply", "Book a time"] },
    matching: { ...base, type: "matching", ideaKey: "match-terms", prompt: "Match the terms.", pairsLeft: ["Speed", "Routing"], pairsRight: ["How fast", "Where it goes"] },
  };
  return { items: types.map((t) => all[t]) };
}

beforeEach(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  db = seedFake();
  fake.db = db;
  await seedCourse();
  ai.reset();
  ai.parse = async (p) => {
    const sys = typeof p.system === "string" ? p.system : (p.system as { text: string }[]).map((b) => b.text).join("\n");
    if (sys.startsWith("You write practice items")) return { stop_reason: "end_turn", usage, parsed_output: pool(passagesMatching(promptText(p), /five minutes/)[0]) };
    return { stop_reason: "end_turn", usage: { ...usage, output_tokens: 200 }, parsed_output: { feedback: "Good start: you named speed. Add why leads cool. Score 7/10." } };
  };
});

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const draft = (role: RoleKey = "owner") => call(draftRoute, "POST", `/api/v1/courses/${SLUG}/lessons/${lessonId}/activities`, role, {}, { slug: SLUG, id: lessonId });
const library = async (role: RoleKey = "reviewer") => libraryFrom((await call(libraryRoute, "GET", `/api/v1/courses/${SLUG}/activities`, role, undefined, { slug: SLUG })).body)!;
const items = () => db.data.activity_items ?? [];
const review = (id: string, decision: string, note = "Answer key and citation match the source", role: RoleKey = "reviewer") =>
  call(reviewRoute, "POST", `/api/v1/courses/${SLUG}/activities/${id}/review`, role, { decision, note }, { slug: SLUG, id });
const publish = (role: RoleKey = "owner") => call(publishRoute, "POST", `/api/v1/courses/${SLUG}/modules/${moduleId}/activities/publish`, role, { reason: "Reviewed and ready for learners" }, { slug: SLUG, id: moduleId });
const lesson = async (role: RoleKey = "learner") => lessonActivitiesFrom((await call(lessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, role, undefined, { id: lessonId })).body)!;
const attempt = (id: string, body: unknown, role: RoleKey = "learner") => call(attemptRoute, "POST", `/api/v1/learn/activities/${id}/attempt`, role, body, { id });
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);
async function publishedPool() {
  await draft();
  for (const i of items()) await review(String(i.id), "approve");
  expect((await publish()).status).toBe(200);
  return items();
}

describe("item types (pure)", () => {
  it("code-graded items need a complete answer key; feedback items never have one", () => {
    expect(checkItem("multiple_choice", { options: ["a", "b"] }, { correct: 1 })).toBeNull();
    expect(checkItem("multiple_choice", { options: ["a", "b"] }, { correct: 2 })).toMatch(/correct one/);
    expect(checkItem("ordering", { steps: ["a", "b", "c"] }, { order: [2, 0, 1] })).toBeNull();
    expect(checkItem("ordering", { steps: ["a", "b", "c"] }, { order: [0, 0, 1] })).not.toBeNull();
    expect(checkItem("short_answer", { sampleAnswer: "x" }, { correct: 1 })).toMatch(/no answer key/);
    expect(checkItem("teach_back", { keyPoints: ["speed"] }, null)).toBeNull();
  });

  it("grades by code; the flashcard self-check records what the learner says; anything else isn't graded", () => {
    expect(grade("multiple_choice", { correct: 1 }, { choice: 1 })).toMatchObject({ correct: true });
    expect(grade("true_false", { correct: false }, { value: true })).toMatchObject({ correct: false, correctAnswer: false });
    expect(grade("matching", { pairs: [1, 0] }, { pairs: [1, 0] })).toMatchObject({ correct: true });
    expect(grade("ordering", { order: [2, 0, 1] }, { order: [0, 1, 2] })).toMatchObject({ correct: false });
    expect(grade("flashcard", { back: "Who, result, first step" }, { knew: true })).toMatchObject({ correct: true, correctAnswer: "Who, result, first step" });
    expect(grade("short_answer", null, { text: "x" })).toBeNull();
    expect(grade("multiple_choice", { correct: 1 }, { choice: "1" })).toBeNull();
  });

  it("a learner never sees the key or the reveal; shuffles never keep the original order", () => {
    expect(learnerContent("short_answer", { sampleAnswer: "secret" })).toEqual({});
    expect(learnerContent("branching_scenario", { options: [{ text: "A", outcome: "o", fit: "strong" }] })).toEqual({ options: [{ text: "A" }] });
    for (const seed of ["a", "b", "c", "d"]) expect(seededOrder(3, seed)).not.toEqual([0, 1, 2]);
  });

  it("drops an item without a passage, an incomplete one, one that copies the source, or one calling something attorney-approved", () => {
    const passages = [{ n: 1, sourceId: "s1", claimId: null, quote: "q", text: "Respond to new leads within five minutes because leads cool quickly after the first hour of waiting for a reply from anyone at all" }];
    const sources = [{ id: "s1", title: "T", url: null, license: "open", lastChecked: null, pageAge: null, researchRunId: null }];
    const base = { level: "beginner" as const, goal: "g", interests: [], explanation: "why" };
    const { items: kept, dropped } = toPoolItems({ items: [
      { ...base, type: "multiple_choice", ideaKey: "a", prompt: "Q?", options: ["x", "y"], correctIndex: 0, passage: 9 },
      { ...base, type: "multiple_choice", ideaKey: "b", prompt: "Q?", options: ["x"], correctIndex: 0, passage: 1 },
      { ...base, type: "short_answer", ideaKey: "c", prompt: "Explain.", sampleAnswer: "Respond to new leads within five minutes because leads cool quickly after the first hour of waiting for a reply from anyone at all", passage: 1 },
      { ...base, type: "short_answer", ideaKey: "d", prompt: "Is this attorney-approved?", sampleAnswer: "x", passage: 1 },
      { ...base, type: "matching", ideaKey: "E e", prompt: "Match.", pairsLeft: ["a", "b", "c"], pairsRight: ["1", "2", "3"], passage: 1 },
    ] }, passages, sources);
    expect(dropped.map((d) => d.reason)).toEqual(["no passage to cite", "incomplete: Give 2 to 6 options and the correct one.", "copies a source too closely", "calls something attorney-approved"]);
    expect(kept).toHaveLength(1);
    const m = kept[0];
    expect(m).toMatchObject({ idea_key: "e-e", grading: "code", citation: { sourceId: "s1", title: "T" } });
    // The key points each left item at its right item wherever the shuffle put it.
    const right = m.content.right as string[];
    expect((m.answer_key!.pairs as number[]).map((i) => right[i])).toEqual(["1", "2", "3"]);
  });
});

describe("pool drafting", () => {
  it("drafts a cited pool from the lesson's approved sources as Draft items, on Haiku with the sources cached", async () => {
    const r = await draft();
    expect(poolDraftedFrom(r.body)).toEqual({ drafted: 4, types: 4, dropped: 0, code: 3, replacing: 0 });
    expect(items().every((i) => i.status === "draft" && (i.citation as { sourceId: string }).sourceId === "s-speed")).toBe(true);
    const req = ai.requests.at(-1)!.params as { model: string; system: { cache_control?: unknown }[] };
    expect(req.model).toBe("claude-haiku-4-5");
    expect(req.system.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(audit("courses.activities.draft")).toEqual([expect.objectContaining({ result: "completed", previous_value: "0 published item(s)", new_value: "4 draft item(s)" })]);
    expect((await draft()).status).toBe(409);
  });

  it("only course builders draft; nothing is drafted without approved sources; AI off is a plain refusal", async () => {
    expect((await draft("reviewer")).status).toBe(403);
    db.data.sources[0].status = "proposed";
    expect((await draft()).body.reason).toMatch(/Items are written only from approved sources/);
    db.data.sources[0].status = "approved";
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await draft()).status).toBe(503);
  });
});

describe("review and publishing", () => {
  it("a Reviewer edits a Draft (audited with before and after), approves with a note, or rejects; a Course Admin can't review", async () => {
    await draft();
    const [mc, tf] = items();
    const edit = await call(itemRoute, "PATCH", `/api/v1/courses/${SLUG}/activities/${mc.id}`, "reviewer", { prompt: "How quickly should you reply to a new lead?" }, { slug: SLUG, id: String(mc.id) });
    expect(itemStatusFrom(edit.body)).toEqual({ id: mc.id, status: "draft" });
    expect(audit("courses.activities.edit")[0]).toMatchObject({ previous_value: expect.stringContaining("How fast"), new_value: expect.stringContaining("How quickly") });
    expect((await review(String(mc.id), "approve", "ok")).status).toBe(400);
    expect((await review(String(mc.id), "approve", undefined, "courseAdmin")).status).toBe(403);
    expect(itemStatusFrom((await review(String(mc.id), "approve")).body)).toEqual({ id: mc.id, status: "approved" });
    expect(itemStatusFrom((await review(String(tf.id), "reject", "The statement is ambiguous")).body)).toEqual({ id: tf.id, status: "rejected" });
    // Refusals are audited too (blocked); the decisions carry the previous and new state.
    expect(audit("courses.activities.review").map((e) => [e.previous_value, e.new_value, e.result])).toEqual([
      [null, null, "blocked"], ["draft", "approved", "completed"], ["draft", "rejected", "completed"],
    ]);
    expect((await review(String(mc.id), "reject", "Changed my mind")).status).toBe(409);
  });

  it("the library shows counts by type and level; a module with fewer than 3 types can't be published, and the Owner sees it", async () => {
    await draft();
    const [mc, tf, sa] = items();
    await review(String(mc.id), "approve");
    await review(String(tf.id), "approve");
    const lib = await library();
    expect(lib.modules[0].lessons[0].counts).toEqual({ byType: { multiple_choice: 1, true_false: 1, short_answer: 1, ordering: 1 }, byLevel: { beginner: 3, intermediate: 1 } });
    expect(lib.modules[0].variety).toMatchObject({ types: 2, ok: false, approved: 2, min: 3 });
    expect(await publish()).toMatchObject({ status: 409, body: { reason: expect.stringMatching(/at least 3 different activity types to be published; this one would have 2/) } });
    expect(audit("courses.activities.publish")[0]).toMatchObject({ result: "blocked" });
    await review(String(sa.id), "approve");
    const r = await publish();
    expect(modulePublishedFrom(r.body)).toEqual({ moduleId, published: 3, types: 3 });
    expect(audit("courses.activities.publish").at(-1)).toMatchObject({ result: "completed", previous_value: "0 type(s) published", new_value: "3 item(s) published; 3 type(s) live" });
    expect((await publish("reviewer")).status).toBe(403);
  });
});

describe("learners", () => {
  it("never see a Draft item; see published ones without the key", async () => {
    await draft();
    expect((await lesson()).activities).toEqual([]);
    await publishedPool().catch(() => undefined);
    const l = await lesson();
    expect(l.activities.map((a) => a.type).sort()).toEqual(["multiple_choice", "ordering", "short_answer", "true_false"]);
    expect(JSON.stringify(l.activities)).not.toMatch(/correct|sampleAnswer|Leads cool quickly, so/);
    expect(l.activities.find((a) => a.type === "short_answer")).toMatchObject({ graded: false, label: "Practice, not graded" });
    expect(l.score).toEqual({ graded: 3, correct: 0 });
  });

  it("a code-graded item is graded at once with the correct answer and a cited explanation, and counts", async () => {
    const pub = await publishedPool();
    const mc = pub.find((i) => i.item_type === "multiple_choice")!;
    const wrong = attemptFrom((await attempt(String(mc.id), { answer: { choice: 1 } })).body)!;
    expect(wrong).toMatchObject({ graded: true, correct: false, correctAnswer: 0, explanation: expect.stringMatching(/five minutes/), citation: { title: "Speed to lead study", url: "https://example.org/speed" }, score: { graded: 3, correct: 0 } });
    const right = attemptFrom((await attempt(String(mc.id), { answer: { choice: 0 } })).body)!;
    expect(right).toMatchObject({ graded: true, correct: true, score: { graded: 3, correct: 1 } });
    expect(db.data.activity_attempts.map((a) => [a.graded_by, a.correct, a.counted])).toEqual([["code", false, true], ["code", true, true]]);
    expect((await attempt(String(mc.id), { answer: { choice: "zero" } })).status).toBe(400);
  });

  it("a practice item is labeled not graded, reveals its sample, stores no answer, and never counts", async () => {
    const pub = await publishedPool();
    const sa = pub.find((i) => i.item_type === "short_answer")!;
    const r = attemptFrom((await attempt(String(sa.id), { answer: "my private words" })).body)!;
    expect(r).toMatchObject({ graded: false, label: "Practice, not graded", reveal: { sampleAnswer: expect.stringMatching(/first useful reply/) } });
    expect(db.data.activity_attempts).toEqual([expect.objectContaining({ graded_by: "none", correct: null, counted: false, answer: null })]);
    expect(JSON.stringify(db.data)).not.toMatch(/my private words/);
  });

  it("AI feedback: practice items only, labeled, against the Mentor allowance, never a score", async () => {
    const pub = await publishedPool();
    const sa = pub.find((i) => i.item_type === "short_answer")!;
    const mc = pub.find((i) => i.item_type === "multiple_choice")!;
    const fb = (id: string, answer = "Because leads go cold") => call(feedbackRoute, "POST", `/api/v1/learn/activities/${id}/feedback`, "learner", { answer }, { id });
    expect(await fb(String(sa.id))).toMatchObject({ status: 402, body: { reason: expect.stringMatching(/needs a Mentor allowance/) } });
    db.data.subscriptions = [{ id: "sub-l", payer_account_id: ROLE_ID.learner, beneficiary_account_id: ROLE_ID.learner, plan: "basic", status: "active", mentor_addon_cents: 500, renews_at: "2099-01-01T00:00:00.000Z", created_at: "2026-01-01" }];
    db.data.mentor_allowance_periods = [{ id: "per-l", subscription_id: "sub-l", account_id: ROLE_ID.learner, period_start: "2026-01-01T00:00:00.000Z", period_end: "2099-01-01T00:00:00.000Z", addon_cents: 500, trial: false }];
    expect((await fb(String(mc.id))).status).toBe(409);
    const r = feedbackFrom((await fb(String(sa.id))).body)!;
    expect(r).toMatchObject({ label: "AI feedback · Practice, not graded", feedback: "Good start: you named speed. Add why leads cool. Score ." });
    expect(db.data.mentor_allowance_usage).toHaveLength(1);
    expect((ai.requests.at(-1)!.params as { model: string }).model).toBe("claude-haiku-4-5");
    expect(JSON.stringify(db.data)).not.toMatch(/Because leads go cold/);
  });
});

describe("Reviewer insight and refreshes", () => {
  it("common misses per lesson, counts only and no names", async () => {
    const pub = await publishedPool();
    const mc = pub.find((i) => i.item_type === "multiple_choice")!;
    await attempt(String(mc.id), { answer: { choice: 2 } });
    await attempt(String(mc.id), { answer: { choice: 2 } }, "support");
    await attempt(String(mc.id), { answer: { choice: 0 } }, "courseAdmin");
    const m = missesFrom((await call(missesRoute, "GET", `/api/v1/courses/${SLUG}/lessons/${lessonId}/misses`, "reviewer", undefined, { slug: SLUG, id: lessonId })).body)!;
    expect(m.find((x) => x.id === mc.id)).toMatchObject({ attempts: 3, correct: 1, misses: [{ answer: 2, count: 2 }] });
    expect(JSON.stringify(m)).not.toMatch(new RegExp(`${ROLE_ID.learner}|${ROLE_ID.support}|learner@|support@`));
    expect((await call(missesRoute, "GET", `/api/v1/courses/${SLUG}/lessons/${lessonId}/misses`, "courseAdmin", undefined, { slug: SLUG, id: lessonId })).status).toBe(403);
  });

  it("a refresh never edits a published item: new drafts point at it, with a diff, and replace it only when published", async () => {
    const pub = await publishedPool();
    const mc = pub.find((i) => i.item_type === "multiple_choice")!;
    expect((await call(itemRoute, "PATCH", `/api/v1/courses/${SLUG}/activities/${mc.id}`, "reviewer", { prompt: "Changed?" }, { slug: SLUG, id: String(mc.id) })).status).toBe(409);
    ai.parse = async (p) => ({ stop_reason: "end_turn", usage, parsed_output: { items: [{ ...pool(passagesMatching(promptText(p), /five minutes/)[0]).items[0], prompt: "How soon should a first reply go out?" }] } });
    expect(poolDraftedFrom((await draft()).body)).toMatchObject({ drafted: 1, replacing: 1 });
    const next = (await library()).modules[0].lessons[0].items.find((i) => i.status === "draft")!;
    expect(next).toMatchObject({ replaces: { id: mc.id, version: 1, status: "published" }, version: 2 });
    expect(next.diff!.filter((d) => d.op !== "same")).toEqual([
      { op: "remove", text: "Prompt: How fast should you reply to a new lead?" }, { op: "add", text: "Prompt: How soon should a first reply go out?" },
    ]);
    await review(next.id, "approve");
    await publish();
    expect(items().find((i) => i.id === mc.id)!.status).toBe("archived");
    expect((await lesson()).activities.find((a) => a.type === "multiple_choice")!.prompt).toBe("How soon should a first reply go out?");
  });
});
