/**
 * L4: the Mentor through the real routes (database faked in memory, Clerk mocked, the Anthropic SDK replaced). Course-
 * grounded answers with citations; "not in the sources" instead of guessing; no graded work; the teen rules (keyed to
 * accounts.is_minor: personal details removed, off-topic redirect, the teen safety response, a SafetyEvent at the front
 * of the queue, the Guardian-alert placeholder); safety checks on input and output; the daily and spend caps; privacy
 * (threads are the learner's only, and nothing else holds their text). Unsafe teen topics are tested here, in code,
 * never on a real account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, promptText } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l4", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as mentorRoute from "@/app/api/v1/mentor/route";
import * as threadsRoute from "@/app/api/v1/mentor/threads/route";
import * as threadRoute from "@/app/api/v1/mentor/threads/[id]/route";
import * as safetyRoute from "@/app/api/v1/safety/events/route";
import * as reviewRoute from "@/app/api/v1/safety/events/[id]/review/route";
import * as exportRoute from "@/app/api/v1/privacy/export/route";
import { GRADED_REFUSAL, NOT_IN_SOURCES, OFF_TOPIC_TEEN, PAUSED, redactPersonalData, safetySignal } from "@/lib/mentor/rules";
import { MENTOR_SYSTEM, TEEN_RULES } from "@/lib/mentor/mentor";
import { mentorReplyFrom, mentorThreadFrom, mentorThreadsFrom, safetyEventsFrom } from "@/app/mentor-api";

type Db = ReturnType<typeof seedFake>;
let db: Db;
let lessonA = "";
let lessonB = "";
let screenAnswer: Record<string, unknown>;
let replyScreen: Record<string, unknown>;
let answer: Record<string, unknown>;

const usage = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const OK_SCREEN = { category: "none", gradedWork: false, onTopic: true, asksPersonalData: false };

async function course(slug: string, name: string, para: string, sourceId: string) {
  const a = (await db.client.from("academies").insert({ slug, name }).select("id").single()).data as { id: string };
  const c = (await db.client.from("courses").insert({ academy_id: a.id, version: 1, status: "published" }).select("id").single()).data as { id: string };
  const m = (await db.client.from("modules").insert({ course_id: c.id, position: 1, code: "m1", title: "Basics" }).select("id").single()).data as { id: string };
  const l = (await db.client.from("lessons").insert({ module_id: m.id, position: 1, title: `${name} basics` }).select("id").single()).data as { id: string };
  await db.client.from("lesson_versions").insert({
    lesson_id: l.id, course_id: c.id, version: 1, status: "published", title: `${name} basics`, published_at: "2026-09-01",
    body: { summary: "", sections: [{ heading: "H", paragraphs: [{ text: para, refs: [1] }] }], takeaways: [] },
    citations: [{ ref: 1, sourceId, title: `${name} study`, url: `https://example.org/${slug}`, license: "open", lastChecked: "2026-09-01" }],
  });
  return l.id;
}

beforeEach(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  vi.stubEnv("MENTOR_DAILY_CAP", "");
  db = seedFake();
  fake.db = db;
  db.data.entitlements = [{ id: "e1", account_id: ROLE_ID.learner, tier: "pro", valid_from: "2026-01-01T00:00:00Z", valid_until: null }];
  db.data.sources = [];
  for (const [id, slug] of [["s-leads", "leads"], ["s-sales", "sales"]]) {
    db.data.sources.push({ id, title: `${slug} study`, url: `https://example.org/${slug}`, status: "approved", academy_id: null, license_class: "open" });
    await db.client.rpc("put_source_chunks", { p_source: id, p_chunks: [{ position: 0, text: slug === "leads" ? "Respond to new leads within five minutes." : "Ask open questions on sales calls." }] });
  }
  lessonA = await course("leads", "Lead response", "Reply to new leads within five minutes.", "s-leads");
  lessonB = await course("sales", "Sales calls", "Ask open questions.", "s-sales");
  ai.reset();
  screenAnswer = { ...OK_SCREEN };
  replyScreen = { ...OK_SCREEN };
  answer = { kind: "answer", text: "Reply within five minutes [P1]; leads cool fast.", passages: [1] };
  ai.parse = async (p) => {
    const sys = typeof p.system === "string" ? p.system : (p.system as { text: string }[]).map((b) => b.text).join("\n");
    if (sys.startsWith("You screen text")) {
      const isReply = /reply from the Mentor/.test(promptText(p));
      return { stop_reason: "end_turn", usage, parsed_output: isReply ? replyScreen : screenAnswer };
    }
    return { stop_reason: "end_turn", usage, parsed_output: answer };
  };
});
afterEach(() => vi.unstubAllEnvs());

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
const ask = (message: string, extra: Record<string, unknown> = {}, role: RoleKey = "learner") =>
  call(mentorRoute, "POST", "/api/v1/mentor", role, { lessonId: lessonA, message, ...extra });
const teen = () => { db.data.accounts.find((a) => a.id === ROLE_ID.learner)!.is_minor = true; };
const parses = () => ai.requests.filter((r) => r.kind === "parse");

describe("answers from the course's sources", () => {
  it("answers with a citation of the approved source it draws on, on Haiku, checking the message and the reply", async () => {
    const r = await ask("How fast should I reply to a new lead?");
    const reply = mentorReplyFrom(r.body)!;
    expect(reply.reply).toMatchObject({ role: "mentor", kind: "answer", text: "Reply within five minutes; leads cool fast.", citations: [{ ref: 1, sourceId: "s-leads", title: "Lead response study" }] });
    expect(parses().map((x) => (x.params as { model: string }).model)).toEqual(["claude-haiku-4-5", "claude-haiku-4-5", "claude-haiku-4-5"]);
    expect(promptText(parses()[1].params)).toMatch(/P1 \[Lead response study\]: Reply to new leads within five minutes\./);
    expect(promptText(parses()[1].params)).not.toMatch(/Sales calls study/);
    expect((parses()[1].params as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    expect(reply.mentor).toEqual({ aiOn: true, dailyCap: 40 });
    expect(db.data.mentor_daily_usage).toMatchObject([{ account_id: ROLE_ID.learner, messages: 1 }]);
  });

  it("says the sources don't cover it instead of guessing (also when an 'answer' cites nothing)", async () => {
    answer = { kind: "not_in_sources", text: "No passage covers that.", passages: [] };
    expect(mentorReplyFrom((await ask("What's the best CRM for plumbers?")).body)!.reply).toMatchObject({ kind: "not_in_sources", text: NOT_IN_SOURCES });
    answer = { kind: "answer", text: "Probably HubSpot.", passages: [] };
    expect(mentorReplyFrom((await ask("Which CRM?")).body)!.reply).toMatchObject({ kind: "not_in_sources", text: NOT_IN_SOURCES });
  });

  it("keeps the conversation in the learner's private thread, and the reply's history goes back as earlier turns", async () => {
    const first = mentorReplyFrom((await ask("How fast should I reply?")).body)!;
    await ask("And why?", { threadId: first.thread.id });
    const answerCall = parses().filter((x) => (x.params as { system: string }).system?.startsWith?.("You are ASCENTRA's Mentor")).at(-1)!.params as { messages: { role: string }[] };
    expect(answerCall.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const t = mentorThreadFrom((await call(threadRoute, "GET", `/api/v1/mentor/threads/${first.thread.id}`, "learner", undefined, { id: first.thread.id })).body)!;
    expect(t.messages.map((m) => m.role)).toEqual(["learner", "mentor", "learner", "mentor"]);
    expect(mentorThreadsFrom((await call(threadsRoute, "GET", `/api/v1/mentor/threads?lessonId=${lessonA}`, "learner")).body)!.threads).toHaveLength(1);
  });

  it("works only on a published lesson; is off with a plain message without ANTHROPIC_API_KEY", async () => {
    expect((await call(mentorRoute, "POST", "/api/v1/mentor", "learner", { lessonId: "00000000-0000-4000-8000-000000000999", message: "hi" })).status).toBe(404);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await ask("How fast?")).toMatchObject({ status: 503, body: { reason: "The Mentor is off right now (AI isn't set up). Your lessons work as usual." } });
  });
});

describe("graded work", () => {
  it("refuses to complete an assignment without calling the model, and offers explanation and hints", async () => {
    const r = await ask("Can you complete my assignment for module 1?");
    expect(mentorReplyFrom(r.body)!.reply).toMatchObject({ kind: "graded_refusal", text: GRADED_REFUSAL });
    expect(GRADED_REFUSAL).toMatch(/explain the idea.*hints/);
    expect(parses()).toHaveLength(0);
  });

  it("refuses when the screen spots graded work, and replaces a reply that would complete it", async () => {
    screenAnswer = { ...OK_SCREEN, gradedWork: true };
    expect(mentorReplyFrom((await ask("Here's question 3 of my check, what do I put?")).body)!.reply.kind).toBe("graded_refusal");
    screenAnswer = { ...OK_SCREEN };
    replyScreen = { ...OK_SCREEN, gradedWork: true };
    expect(mentorReplyFrom((await ask("Explain lead response.")).body)!.reply).toMatchObject({ kind: "graded_refusal", text: GRADED_REFUSAL });
  });
});

describe("teen rules (accounts.is_minor)", () => {
  it("removes personal details before anything is stored or sent, and says so; uses the stricter rules", async () => {
    teen();
    const r = await ask("I'm at jo@example.com or 555-123-4567, how fast should I reply?");
    expect(mentorReplyFrom(r.body)!.reply.note).toMatch(/removed some personal details/);
    for (const p of parses()) expect(promptText(p.params)).not.toMatch(/jo@example|555-123/);
    expect(promptText(parses()[1].params)).toContain(TEEN_RULES.split("\n")[0]);
    expect(JSON.stringify(db.data.mentor_threads)).not.toMatch(/jo@example|555-123/);
  });

  it("redirects off-topic chat back to the course", async () => {
    teen();
    screenAnswer = { ...OK_SCREEN, onTopic: false };
    expect(mentorReplyFrom((await ask("What's your favorite video game?")).body)!.reply).toMatchObject({ kind: "off_topic", text: OFF_TOPIC_TEEN });
  });

  it("gives the teen safety response before any model call, pauses the thread, and puts a SafetyEvent at the front of the queue", async () => {
    teen();
    const r = mentorReplyFrom((await ask("i want to kill myself")).body)!;
    expect(r.reply.kind).toBe("safety");
    expect(r.reply.text).toMatch(/988/);
    expect(r.reply.text).toMatch(/trusted adult/);
    expect(r.reply.text).not.toMatch(/kill myself/);
    expect(r.thread.status).toBe("paused");
    expect(parses()).toHaveLength(0);
    expect(db.data.safety_events).toEqual([expect.objectContaining({
      subject_account_id: ROLE_ID.learner, category: "self_harm", stage: "input", is_minor: true, priority: 0, severity: "urgent",
      guardian_policy: expect.stringMatching(/^PLACEHOLDER \(counsel item\)/), actions_taken: expect.arrayContaining(["Guardian alert: not sent (policy placeholder)"]),
    })]);
    expect(JSON.stringify(db.data.safety_events)).not.toMatch(/kill myself/);
    expect(JSON.stringify(db.data.audit_events)).not.toMatch(/kill myself/);
    expect(mentorReplyFrom((await ask("ok", { threadId: r.thread.id })).body)!.reply).toMatchObject({ kind: "paused", text: PAUSED });
  });

  it("an abuse signal points a teen to the child abuse hotline", async () => {
    teen();
    screenAnswer = { ...OK_SCREEN, category: "abuse" };
    expect(mentorReplyFrom((await ask("my uncle does things that scare me")).body)!.reply.text).toMatch(/Childhelp/);
  });
});

describe("safety checks on input and output", () => {
  it("an adult gets the adult response; the event is urgent but behind a teen's; the thread isn't paused", async () => {
    screenAnswer = { ...OK_SCREEN, category: "abuse" };
    const r = mentorReplyFrom((await ask("my partner keeps hurting me")).body)!;
    expect(r.reply.text).toMatch(/Domestic Violence Hotline/);
    expect(r.thread.status).toBe("open");
    expect(db.data.safety_events[0]).toMatchObject({ category: "abuse", is_minor: false, priority: 1, guardian_policy: null });
  });

  it("an unsafe reply is never shown: the safety response replaces it and the event is recorded at the output stage", async () => {
    replyScreen = { ...OK_SCREEN, category: "violence" };
    expect(mentorReplyFrom((await ask("Explain lead response.")).body)!.reply.kind).toBe("safety");
    expect(db.data.safety_events[0]).toMatchObject({ category: "violence", stage: "output", severity: "standard", priority: 2 });
  });

  it("the review queue is the Owner's and Super Admins'; it shows no conversation text; reviewing needs a note", async () => {
    teen();
    await ask("i want to kill myself");
    expect((await call(safetyRoute, "GET", "/api/v1/safety/events", "support")).status).toBe(403);
    const events = safetyEventsFrom((await call(safetyRoute, "GET", "/api/v1/safety/events?status=open", "owner")).body)!;
    expect(events).toEqual([expect.objectContaining({ category: "self_harm", teen: true, priority: 0, status: "open", subject: expect.objectContaining({ id: ROLE_ID.learner }) })]);
    expect(JSON.stringify(events)).not.toMatch(/kill myself/);
    const id = events[0].id;
    expect((await call(reviewRoute, "POST", `/api/v1/safety/events/${id}/review`, "superAdmin", {}, { id })).status).toBe(400);
    expect((await call(reviewRoute, "POST", `/api/v1/safety/events/${id}/review`, "superAdmin", { reason: "Followed up per process" }, { id })).status).toBe(200);
  });

  it("the fixed signals and the teen redaction", () => {
    expect([safetySignal("I want to die"), safetySignal("he hits me every night"), safetySignal("I'm going to hurt someone"), safetySignal("five minute replies")])
      .toEqual(["self_harm", "abuse", "threat", null]);
    expect(redactPersonalData("Email a.b@x.co, call (555) 123-4567, I live at 12 Oak Street, I'm @jojo_22")).toEqual({
      text: "Email [email removed], call [phone removed], I live at [address removed], I'm [handle removed]", removed: true,
    });
  });
});

describe("limits and plans", () => {
  it("stops at the daily message cap with a plain message", async () => {
    vi.stubEnv("MENTOR_DAILY_CAP", "2");
    await ask("How fast?");
    await ask("Why?");
    expect(await ask("And?")).toMatchObject({ status: 429, body: { reason: expect.stringMatching(/^You've reached today's Mentor limit \(2 messages\)/) } });
  });

  it("stops at the AI spend cap with a plain message", async () => {
    vi.stubEnv("AI_DAILY_CAP_USD", "0.001");
    expect(await ask("How fast?")).toMatchObject({ status: 429, body: { reason: expect.stringMatching(/^The Mentor is resting for today/) } });
  });

  it("Basic covers one subject; Pro any course; no plan, no Mentor", async () => {
    db.data.entitlements[0].tier = "basic";
    expect((await ask("How fast?")).status).toBe(200);
    const other = await call(mentorRoute, "POST", "/api/v1/mentor", "learner", { lessonId: lessonB, message: "How do I open a call?" });
    expect(other).toMatchObject({ status: 403, body: { reason: "Your plan's Mentor covers one subject: Lead response. Pro adds more subjects." } });
    db.data.entitlements[0].tier = "pro";
    expect((await call(mentorRoute, "POST", "/api/v1/mentor", "learner", { lessonId: lessonB, message: "How do I open a call?" })).status).toBe(200);
    db.data.entitlements = [];
    expect((await ask("How fast?")).status).toBe(403);
  });
});

describe("privacy", () => {
  it("threads are the learner's alone; the call log holds no text; the download includes them; the learner can delete them", async () => {
    const r = mentorReplyFrom((await ask("How fast should I reply?")).body)!;
    for (const role of ["support", "owner", "superAdmin"] as const) {
      expect((await call(threadRoute, "GET", `/api/v1/mentor/threads/${r.thread.id}`, role, undefined, { id: r.thread.id })).status).toBe(404);
    }
    expect(JSON.stringify(db.data.ai_calls)).not.toMatch(/reply|lead/i);
    expect(JSON.stringify(db.data.audit_events)).not.toMatch(/How fast/);
    const exported = await call(exportRoute, "POST", "/api/v1/privacy/export", "learner", {});
    expect(exported.body.data.mentorThreads).toEqual([expect.objectContaining({ title: "How fast should I reply?", messages: expect.arrayContaining([expect.objectContaining({ text: "How fast should I reply?" })]) })]);
    expect((await call(threadsRoute, "DELETE", "/api/v1/mentor/threads", "learner")).body).toEqual({ deleted: 1 });
    expect(db.data.mentor_threads).toEqual([]);
  });

  it("the system prompt keeps the Mentor to the course and its sources, and off graded work", () => {
    expect(MENTOR_SYSTEM).toMatch(/only from the numbered passages/);
    expect(MENTOR_SYSTEM).toMatch(/Never write or complete graded work/);
    expect(MENTOR_SYSTEM).toMatch(/not_in_sources/);
  });
});
