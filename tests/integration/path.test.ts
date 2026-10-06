/**
 * L7 against real Postgres behind PostgREST: the interview and the personalized path through the real routes, with only
 * the Anthropic SDK stubbed. A Basic learner answers and gets a one-subject path of published courses only (the Draft
 * course is never offered); a different goal picks different practice items from the published pool; on Pro the path
 * spans subjects, ordered by AI from the answers only. A topic with no course becomes an anonymous request in the Course
 * Admin queue. The audit chain stays intact. Every response a page reads goes through its reader.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, promptText } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as interviewRoute from "@/app/api/v1/learn/interview/route";
import * as pathRoute from "@/app/api/v1/learn/path/route";
import * as addRoute from "@/app/api/v1/learn/path/courses/route";
import * as modeRoute from "@/app/api/v1/learn/path/activities/route";
import * as requestRoute from "@/app/api/v1/learn/course-requests/route";
import * as queueRoute from "@/app/api/v1/course-requests/route";
import * as decideRoute from "@/app/api/v1/course-requests/[id]/decide/route";
import * as lessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import { activityModeFrom, courseRequestFrom, interviewFrom, interviewSavedFrom, pathFrom, requestDecidedFrom, requestsFrom } from "@/app/path-api";
import { lessonActivitiesFrom } from "@/app/activities-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
let leadsLesson = "";
const usage = { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

async function course(slug: string, name: string, outcome: string, publish: boolean) {
  const a = (await q("insert into public.academies (slug, name, outcome) values ($1, $2, $3) returning id", [slug, name, outcome])).rows[0].id;
  const c = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [a])).rows[0].id;
  const m = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'M') returning id", [c])).rows[0].id;
  const l = (await q("insert into public.lessons (module_id, position, title, minutes) values ($1, 1, $2, 30) returning id", [m, `${name} 1`])).rows[0].id;
  const v = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, last_verified_on, created_by_account_id)
    values ($1, $2, 1, $3, '{"summary":"","sections":[],"takeaways":[]}', '[]', '2026-09-01', $4) returning id`, [l, c, `${name} 1`, ROLE_ID.owner])).rows[0].id;
  if (publish) {
    await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
    await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2 where id = $1", [v, ROLE_ID.reviewer]);
    await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
    await q("update public.courses set status = 'published' where id = $1", [c]);
  }
  return { courseId: c as string, moduleId: m as string, lessonId: l as string };
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  ai.reset();
  // The ranking step keeps the rules' order and says why.
  ai.parse = async (p) => {
    const n = (promptText(p).match(/^\d+\. /gm) ?? []).length;
    return { stop_reason: "end_turn", usage, parsed_output: { order: Array.from({ length: n }, (_, k) => ({ n: k + 1, why: "It fits the goal you chose." })) } };
  };
  await q(`insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', 'basic', now() - interval '1 day')`, [ROLE_ID.learner]);

  const leads = await course("leads", "Lead response", "Reply to leads fast and book more jobs.", true);
  await course("sales", "Sales calls", "Run discovery calls that close.", true);
  await course("drafty", "Draft course", "Not published yet.", false);
  leadsLesson = leads.lessonId;
  // A published pool: 8 ideas over 7 types, at two levels, reviewed and published through the variety rule.
  const src = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
    values ('Speed to lead study', 'web', 'https://example.org/speed', 'approved', $1, now()) returning id`, [ROLE_ID.reviewer])).rows[0].id as string;
  const pool: [string, string, string[], unknown][] = [
    ["multiple_choice", "beginner", ["home-services"], { correct: 0 }], ["true_false", "beginner", [], { correct: true }],
    ["build_it", "intermediate", ["home-services"], null], ["mini_project", "intermediate", [], null], ["teach_back", "intermediate", [], null],
    ["short_answer", "beginner", ["retail"], null], ["case_teardown", "intermediate", ["home-services"], null], ["flashcard", "beginner", [], { pairs: [] }],
  ];
  for (const [n, [type, level, interests, key]] of pool.entries()) {
    const id = (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, interests, prompt, content, answer_key, explanation, citation)
      values ($1, $2, $3, $4, $5, $6, $7, 'Reply to leads fast', $8, $9, $10, $11, 'Because the study says so.', $12) returning id`,
    [leads.lessonId, leads.moduleId, leads.courseId, `idea-${n}`, type, key ? "code" : "feedback", level, interests, `Item ${n}`,
      JSON.stringify(type === "multiple_choice" ? { options: ["Within five minutes", "Next day"] } : {}), key ? JSON.stringify(key) : null,
      JSON.stringify({ sourceId: src, title: "Speed to lead study" })])).rows[0].id;
    await q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now() where id = $1", [id, ROLE_ID.reviewer]);
  }
  await q("select public.publish_module_activities($1, $2)", [leads.moduleId, ROLE_ID.owner]);
}, 60_000);
afterAll(() => stack?.stop());

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const ANSWERS = { goal: "basics", level: "beginner", minutesPerWeek: 120, topics: ["leads"], interests: ["home-services"] };
const answer = async (body: Record<string, unknown> = ANSWERS) => interviewSavedFrom((await call(interviewRoute, "PUT", "/api/v1/learn/interview", "learner", body)).body)!;
const lesson = async () => lessonActivitiesFrom((await call(lessonRoute, "GET", `/api/v1/learn/lessons/${leadsLesson}`, "learner", undefined, { id: leadsLesson })).body)!;

describe("L7 on the real database", () => {
  it("a Basic learner answers from lists and gets a one-subject path of published courses only", async () => {
    const i = interviewFrom((await call(interviewRoute, "GET", "/api/v1/learn/interview", "learner")).body)!;
    expect(i).toMatchObject({ answers: null, plan: "basic" });
    expect(i.options.topics.filter((t) => t.hasCourse).map((t) => t.slug).sort()).toEqual(["leads", "sales"]); // never the Draft course
    const saved = await answer({ ...ANSWERS, topics: ["leads", "sales"] });
    expect(saved.path!.courses).toEqual([expect.objectContaining({ slug: "leads", lastVerifiedOn: "2026-09-01", why: expect.any(String) })]);
    expect(saved.path!.limit).toBe(1);
    expect((await call(addRoute, "POST", "/api/v1/learn/path/courses", "learner", { slug: "sales" })).status).toBe(403);
    expect((await call(addRoute, "POST", "/api/v1/learn/path/courses", "learner", { slug: "drafty" })).status).toBe(404);
    // The database itself refuses a Draft course on a path.
    const drafty = (await q("select id from public.academies where slug = 'drafty'")).rows[0].id;
    const pathId = (await q("select id from public.learner_paths where account_id = $1", [ROLE_ID.learner])).rows[0].id;
    await expect(q("insert into public.learner_path_items (path_id, account_id, academy_id, position, reason) values ($1, $2, $3, 9, 'x')", [pathId, ROLE_ID.learner, drafty])).rejects.toThrow(/only published courses/);
  });

  it("a different goal picks different practice items, each with why; the default set is a switch away", async () => {
    const basics = await lesson();
    expect(basics.selection).toMatchObject({ mode: "personal", personalized: true });
    expect(basics.activities.length).toBeLessThanOrEqual(6);
    expect(new Set(basics.activities.map((a) => a.type)).size).toBeGreaterThanOrEqual(3);
    expect(basics.activities.every((a) => a.why && a.why.length > 0)).toBe(true);
    await answer({ ...ANSWERS, goal: "apply", level: "intermediate" });
    const apply = await lesson();
    expect(apply.activities.map((a) => a.id)).not.toEqual(basics.activities.map((a) => a.id));
    expect(["build_it", "case_teardown"]).toContain(apply.activities[0].type); // hands-on, at their level, matching their interest
    expect(activityModeFrom((await call(modeRoute, "PUT", "/api/v1/learn/path/activities", "learner", { mode: "default" })).body)).toEqual({ mode: "default" });
    expect((await lesson()).activities).toHaveLength(8);
    await call(modeRoute, "PUT", "/api/v1/learn/path/activities", "learner", { mode: "personal" });
  });

  it("on Pro the path spans subjects, ordered by AI from the answers only, with the AI notice", async () => {
    await q("update public.entitlements set tier = 'pro' where account_id = $1", [ROLE_ID.learner]);
    const before = ai.requests.length;
    const p = (await answer({ ...ANSWERS, goal: "apply", topics: ["leads", "sales"] })).path!;
    expect(p.courses.map((c) => c.slug).sort()).toEqual(["leads", "sales"]);
    expect(p).toMatchObject({ method: "ai_ranked", aiNotice: expect.stringMatching(/^AI notice/) });
    const sent = promptText(ai.requests[before].params);
    expect(sent).not.toMatch(new RegExp(`${ROLE_ID.learner}|learner@example.com`));
    expect((await q("select count(*)::int as n from public.ai_calls where purpose = 'paths.rank' and account_id = $1", [ROLE_ID.learner])).rows[0].n).toBeGreaterThan(0);
    expect(pathFrom((await call(pathRoute, "PATCH", "/api/v1/learn/path", "learner", { order: ["sales", "leads"] })).body)!.courses.map((c) => c.slug)).toEqual(["sales", "leads"]);
  });

  it("a requested topic lands anonymously in the Course Admin queue and is decided with a reason", async () => {
    expect(courseRequestFrom((await call(requestRoute, "POST", "/api/v1/learn/course-requests", "learner", { topic: "Beekeeping basics", level: "beginner" })).body)).toMatchObject({ recorded: true });
    const list = requestsFrom((await call(queueRoute, "GET", "/api/v1/course-requests?status=open", "courseAdmin")).body)!;
    expect(list).toEqual([expect.objectContaining({ topic: "Beekeeping basics", level: "beginner", count: 1, status: "open" })]);
    expect((await call(queueRoute, "GET", "/api/v1/course-requests", "learner")).status).toBe(403);
    const id = list[0].id;
    expect(requestDecidedFrom((await call(decideRoute, "POST", `/api/v1/course-requests/${id}/decide`, "courseAdmin", { status: "planned", reason: "Queued in the catalog" }, { id })).body)).toEqual({ id, status: "planned" });
    const adds = (await q("select actor_account_id, context from public.audit_events where action = 'course_requests.add'")).rows;
    expect(adds).toEqual([expect.objectContaining({ actor_account_id: null })]);
  });

  it("audits every path change and queue action, never the answers, and the chain stays intact", async () => {
    const actions = (await q("select distinct action from public.audit_events where action like 'learn.path.%' or action like 'course_requests.%'")).rows.map((r) => r.action).sort();
    expect(actions).toEqual(expect.arrayContaining(["course_requests.add", "course_requests.manage", "learn.path.activities", "learn.path.build", "learn.path.reorder"]));
    const text = JSON.stringify((await q("select previous_value, new_value, context from public.audit_events where action like 'learn.path.%'")).rows);
    expect(text).not.toMatch(/home-services|beginner|120 minutes/);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });
});
