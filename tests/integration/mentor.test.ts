/**
 * L4 against real Postgres behind PostgREST: the Mentor and the safety queue through the real routes, with only the
 * Anthropic SDK stubbed. A Pro learner asks a question the sources answer (cited), one they don't ("not in the
 * sources"), and for graded work (declined); a safety signal reaches the Owner's queue without any conversation text and
 * is reviewed once; threads are the learner's only, in their download, and absent from the logs. Every response the
 * pages read goes through the page's reader.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, promptText } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
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
import { GRADED_REFUSAL, NOT_IN_SOURCES } from "@/lib/mentor/rules";
import { mentorReplyFrom, mentorThreadFrom, mentorThreadsFrom, safetyEventsFrom } from "@/app/mentor-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
let lessonId = "";
const usage = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const OK_SCREEN = { category: "none", gradedWork: false, onTopic: true, asksPersonalData: false };
let answer: Record<string, unknown> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  vi.stubEnv("MENTOR_DAILY_CAP", "");
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  ai.reset();
  ai.parse = async (p) => {
    const sys = typeof p.system === "string" ? p.system : (p.system as { text: string }[]).map((b) => b.text).join("\n");
    if (sys.startsWith("You screen text")) return { stop_reason: "end_turn", usage, parsed_output: OK_SCREEN };
    return { stop_reason: "end_turn", usage, parsed_output: answer };
  };

  // A published lesson citing one approved source; the learner is on Pro.
  await q(`insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', 'pro', now() - interval '1 day')`, [ROLE_ID.learner]);
  const academy = (await q("insert into public.academies (slug, name) values ('mkt', 'Lead response') returning id")).rows[0].id;
  const course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
  const mod = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Speed') returning id", [course])).rows[0].id;
  lessonId = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Why minutes matter') returning id", [mod])).rows[0].id;
  const src = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
    values ('Speed to lead study', 'web', 'https://example.org/speed', 'approved', $1, now()) returning id`, [ROLE_ID.reviewer])).rows[0].id as string;
  await q("select public.put_source_chunks($1, $2::jsonb)", [src, JSON.stringify([{ position: 0, text: "Respond to new leads within five minutes.", quote: "Respond to new leads within five minutes." }])]);
  const body = { summary: "Why speed matters.", sections: [{ heading: "Speed", paragraphs: [{ text: "Reply to new leads within five minutes.", refs: [1] }] }], takeaways: [] };
  const citations = [{ ref: 1, sourceId: src, title: "Speed to lead study", url: "https://example.org/speed", license: "web_summarize_only", lastChecked: "2026-09-01" }];
  const v = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, last_verified_on, created_by_account_id)
    values ($1, $2, 1, 'Why minutes matter', $3, $4, '2026-09-01', $5) returning id`, [lessonId, course, JSON.stringify(body), JSON.stringify(citations), ROLE_ID.owner])).rows[0].id;
  await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
  await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2 where id = $1", [v, ROLE_ID.reviewer]);
  await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
}, 60_000);
afterAll(() => stack?.stop());

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
const ask = (message: string, threadId?: string) => call(mentorRoute, "POST", "/api/v1/mentor", "learner", { lessonId, message, threadId });
let threadId = "";

describe("L4 on the real database", () => {
  it("answers from the course's source with a citation", async () => {
    answer = { kind: "answer", text: "Reply within five minutes [P1].", passages: [1] };
    const r = mentorReplyFrom((await ask("How fast should I reply to a new lead?")).body)!;
    expect(r.reply).toMatchObject({ kind: "answer", citations: [{ ref: 1, title: "Speed to lead study", url: "https://example.org/speed" }] });
    expect(r.mentor).toEqual({ aiOn: true, dailyCap: 40 });
    expect(promptText(ai.requests.filter((x) => x.kind === "parse")[1].params)).toMatch(/Respond to new leads within five minutes|Reply to new leads within five minutes/);
    threadId = r.thread.id;
    expect((await q("select messages from public.mentor_daily_usage where account_id = $1", [ROLE_ID.learner])).rows[0].messages).toBe(1);
  });

  it("says when the sources don't cover it, and declines graded work", async () => {
    answer = { kind: "not_in_sources", text: "No passage covers that.", passages: [] };
    expect(mentorReplyFrom((await ask("Which CRM is best for plumbers?", threadId)).body)!.reply).toMatchObject({ kind: "not_in_sources", text: NOT_IN_SOURCES });
    expect(mentorReplyFrom((await ask("Write my assignment answer for this lesson.", threadId)).body)!.reply).toMatchObject({ kind: "graded_refusal", text: GRADED_REFUSAL });
  });

  it("a safety signal reaches the Owner's queue without conversation text; it's reviewed once, with a note", async () => {
    const r = mentorReplyFrom((await ask("I want to die")).body)!;
    expect(r.reply.kind).toBe("safety");
    expect((await call(safetyRoute, "GET", "/api/v1/safety/events", "support")).status).toBe(403);
    const events = safetyEventsFrom((await call(safetyRoute, "GET", "/api/v1/safety/events?status=open", "owner")).body)!;
    expect(events).toEqual([expect.objectContaining({ category: "self_harm", teen: false, priority: 1, status: "open" })]);
    expect(JSON.stringify(events)).not.toMatch(/want to die/);
    const id = events[0].id;
    expect((await call(reviewRoute, "POST", `/api/v1/safety/events/${id}/review`, "owner", { reason: "Followed up per process" }, { id })).status).toBe(200);
    expect((await call(reviewRoute, "POST", `/api/v1/safety/events/${id}/review`, "superAdmin", { reason: "Again, by mistake" }, { id })).status).not.toBe(200);
    expect(safetyEventsFrom((await call(safetyRoute, "GET", "/api/v1/safety/events?status=reviewed", "superAdmin")).body)).toEqual([expect.objectContaining({ id, status: "reviewed" })]);
  });

  it("threads are the learner's only, are in their download, and never in the logs", async () => {
    expect(mentorThreadsFrom((await call(threadsRoute, "GET", `/api/v1/mentor/threads?lessonId=${lessonId}`, "learner")).body)!.threads.length).toBeGreaterThan(0);
    expect(mentorThreadFrom((await call(threadRoute, "GET", `/api/v1/mentor/threads/${threadId}`, "learner", undefined, { id: threadId })).body)!.messages.length).toBe(6);
    expect((await call(threadRoute, "GET", `/api/v1/mentor/threads/${threadId}`, "owner", undefined, { id: threadId })).status).toBe(404);
    const exported = await call(exportRoute, "POST", "/api/v1/privacy/export", "learner", {});
    expect(JSON.stringify(exported.body.data.mentorThreads)).toMatch(/How fast should I reply to a new lead\?/);
    const logs = JSON.stringify((await q("select * from public.audit_events")).rows) + JSON.stringify((await q("select * from public.ai_calls")).rows);
    expect(logs).not.toMatch(/How fast should I reply|plumbers|want to die|Reply within five minutes/);
    expect((await call(threadsRoute, "DELETE", "/api/v1/mentor/threads", "learner")).status).toBe(200);
    expect((await q("select count(*)::int as n from public.mentor_threads where account_id = $1", [ROLE_ID.learner])).rows[0].n).toBe(0);
  });
});
