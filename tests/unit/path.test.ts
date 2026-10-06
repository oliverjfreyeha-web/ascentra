/**
 * L7: the interview and the personalized path through the real routes (database faked in memory, Clerk mocked, the
 * Anthropic SDK replaced): four answers from fixed lists; a path chosen only from published courses by rules, Basic one
 * subject and Pro several, optionally ordered by AI that sees only the answers; plain fallbacks when AI is off or capped;
 * practice items picked by level, goal and interests with the 3-type rule and a switch to the default set; gaps as
 * anonymous requests in the Course Admin queue; every path change audited without the answers; the Privacy Center.
 * Every page reader is run against the real responses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, promptText } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l7", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as interviewRoute from "@/app/api/v1/learn/interview/route";
import * as skipRoute from "@/app/api/v1/learn/interview/skip/route";
import * as pathRoute from "@/app/api/v1/learn/path/route";
import * as addRoute from "@/app/api/v1/learn/path/courses/route";
import * as removeRoute from "@/app/api/v1/learn/path/courses/[slug]/route";
import * as modeRoute from "@/app/api/v1/learn/path/activities/route";
import * as requestRoute from "@/app/api/v1/learn/course-requests/route";
import * as queueRoute from "@/app/api/v1/course-requests/route";
import * as decideRoute from "@/app/api/v1/course-requests/[id]/decide/route";
import * as lessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import * as exportRoute from "@/app/api/v1/privacy/export/route";
import { checkAnswers, pickCourses, rankPrompt, scoreCourse, selectActivities, type Answers, type Candidate } from "@/lib/path/rules";
import {
  activityModeFrom, courseRequestFrom, interviewFrom, interviewSavedFrom, pathFrom, requestDecidedFrom, requestsFrom,
} from "@/app/path-api";
import { lessonActivitiesFrom } from "@/app/activities-api";

type Db = ReturnType<typeof seedFake>;
let db: Db;
let leadsLesson = "";
const LEARNER = ROLE_ID.learner;

async function course(slug: string, name: string, outcome: string, skills: string[], opts: { published?: boolean; minutes?: number } = {}) {
  const published = opts.published ?? true;
  const a = (await db.client.from("academies").insert({ slug, name, outcome }).select("id").single()).data as { id: string };
  const c = (await db.client.from("courses").insert({ academy_id: a.id, version: 1, status: published ? "published" : "draft" }).select("id").single()).data as { id: string };
  const m = (await db.client.from("modules").insert({ course_id: c.id, position: 1, code: "m1", title: "M" }).select("id").single()).data as { id: string };
  const l = (await db.client.from("lessons").insert({ module_id: m.id, position: 1, title: `${name} 1`, minutes: opts.minutes ?? 30 }).select("id").single()).data as { id: string };
  await db.client.from("lesson_versions").insert({ lesson_id: l.id, course_id: c.id, version: 1, status: published ? "published" : "draft", title: `${name} 1`, last_verified_on: "2026-09-01", published_at: "2026-09-02", body: { summary: "", sections: [], takeaways: [] }, citations: [] });
  for (const s of skills) await db.client.from("skills").insert({ course_id: c.id, module_id: m.id, key: s.toLowerCase().replace(/\s+/g, "-"), name: s });
  return { academyId: a.id, courseId: c.id, moduleId: m.id, lessonId: l.id };
}
const item = (lesson: { courseId: string; moduleId: string; lessonId: string }, n: number, type: string, level: string, interests: string[], idea = `idea-${n}`) => ({
  id: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`, lesson_id: lesson.lessonId, module_id: lesson.moduleId, course_id: lesson.courseId, idea_key: idea, version: 1, status: "published",
  item_type: type, grading: ["multiple_choice", "true_false", "matching", "ordering", "flashcard"].includes(type) ? "code" : "feedback", level, goal: "Practice", interests,
  prompt: `Item ${n}`, content: type === "multiple_choice" ? { options: ["a", "b"] } : {}, answer_key: type === "multiple_choice" ? { correct: 0 } : type === "true_false" ? { correct: true } : null,
  explanation: "Because.", citation: { sourceId: "s1", title: "Study" }, created_at: `2026-09-${String(n).padStart(2, "0")}`,
});

beforeEach(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  db = seedFake();
  fake.db = db;
  const leads = await course("leads", "Lead response", "Reply to leads fast and book more jobs.", ["Response time", "Follow-up"], { minutes: 45 });
  await course("sales", "Sales calls", "Run discovery calls that close.", ["Discovery", "Objections"]);
  await course("drafty", "Draft course", "Not published yet.", [], { published: false });
  leadsLesson = leads.lessonId;
  db.data.activity_items = [
    item(leads, 1, "multiple_choice", "beginner", ["home-services"]),
    item(leads, 2, "true_false", "beginner", []),
    item(leads, 3, "build_it", "intermediate", ["home-services"]),
    item(leads, 4, "mini_project", "intermediate", []),
    item(leads, 5, "teach_back", "intermediate", []),
    item(leads, 6, "flashcard", "beginner", [], "idea-1"),
    item(leads, 7, "short_answer", "beginner", ["retail"]),
    item(leads, 8, "case_teardown", "intermediate", ["home-services"]),
    item(leads, 9, "ordering", "beginner", []),
  ];
  db.data.catalog_topics = [{ id: "t1", slug: "ecom", name: "E-commerce Operations", audience_level: "beginner", origin: "academy_blueprint" }];
  db.data.entitlements = [{ id: "e1", account_id: LEARNER, tier: "trial", valid_from: "2026-01-01T00:00:00Z", valid_until: null }];
  ai.reset();
  ai.parse = async () => ({ stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    parsed_output: { order: [{ n: 2, why: "Your goal is to apply it, and this one is hands-on." }, { n: 1, why: "It builds on the first." }] } });
});

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey = "learner", body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const ANSWERS = { goal: "basics", level: "beginner", minutesPerWeek: 120, topics: ["leads"], interests: ["home-services"] };
const answer = (body: Record<string, unknown> = ANSWERS, role: RoleKey = "learner") => call(interviewRoute, "PUT", "/api/v1/learn/interview", role, body);
const path = async (role: RoleKey = "learner") => pathFrom((await call(pathRoute, "GET", "/api/v1/learn/path", role)).body)!;
const lesson = async () => lessonActivitiesFrom((await call(lessonRoute, "GET", `/api/v1/learn/lessons/${leadsLesson}`, "learner", undefined, { id: leadsLesson })).body)!;
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);
const pro = () => { db.data.entitlements[0].tier = "pro"; };

describe("the rules (pure)", () => {
  const cand = (slug: string, name: string, skills: string[] = [], tags: string[] = [], audience: string | null = null): Candidate =>
    ({ slug, name, outcome: null, skills, audience, tags, minutes: 60, lastVerifiedOn: null });
  const a: Answers = { goal: "basics", level: "beginner", minutesPerWeek: 120, topics: ["leads"], interests: ["home-services"] };

  it("accepts only answers from the lists shown: no free text can get in", () => {
    const allowed = { topics: ["leads", "sales"], interests: ["home-services"] };
    expect(checkAnswers({ ...ANSWERS }, allowed)).toEqual({ answers: ANSWERS });
    expect(checkAnswers({ ...ANSWERS, topics: ["my name is Sam"] }, allowed)).toEqual({ problem: "Choose topics from the list." });
    expect(checkAnswers({ ...ANSWERS, interests: ["sam@example.com"] }, allowed)).toEqual({ problem: "Choose interests from the list." });
    expect(checkAnswers({ ...ANSWERS, minutesPerWeek: 90 }, allowed)).toEqual({ problem: "Choose the time you have each week." });
    expect(checkAnswers({ ...ANSWERS, goal: "be rich" }, allowed)).toEqual({ problem: "Choose a goal." });
  });

  it("scores by chosen topic, words, interests and level, and says why", () => {
    const s = scoreCourse(a, cand("leads", "Lead response", ["Response time"], ["home-services"], "beginner"), { leads: "Lead response" });
    expect(s.score).toBe(14);
    expect(s.reasons).toEqual(['You chose the topic "Lead response".', 'It matches your interest "home-services".', "It's written for beginner learners, like you."]);
  });

  it("Basic gets one subject, Pro several; chosen topics without a published course are gaps", () => {
    const cands = [cand("leads", "Lead response"), cand("sales", "Sales calls", [], ["home-services"])];
    const answers = { ...a, topics: ["leads", "ecom"] };
    expect(pickCourses(answers, cands, "basic").chosen.map((c) => c.slug)).toEqual(["leads"]);
    expect(pickCourses(answers, cands, "pro")).toMatchObject({ chosen: [{ slug: "leads" }, { slug: "sales" }], gaps: ["ecom"] });
  });

  it("picks one item per idea, by level, goal and interests, and keeps 3 kinds when the pool has them", () => {
    const pool = [
      { id: "a", item_type: "multiple_choice", level: "beginner", goal: "g", interests: [], idea_key: "x" },
      { id: "b", item_type: "multiple_choice", level: "beginner", goal: "g", interests: [], idea_key: "y" },
      { id: "c", item_type: "multiple_choice", level: "beginner", goal: "g", interests: [], idea_key: "z" },
      { id: "d", item_type: "true_false", level: "beginner", goal: "g", interests: [], idea_key: "w" },
      { id: "e", item_type: "true_false", level: "beginner", goal: "g", interests: [], idea_key: "v" },
      { id: "f", item_type: "flashcard", level: "beginner", goal: "g", interests: [], idea_key: "u" },
      { id: "g", item_type: "build_it", level: "intermediate", goal: "g", interests: [], idea_key: "t" },
      { id: "h", item_type: "multiple_choice", level: "beginner", goal: "g", interests: [], idea_key: "x" },
    ] as Parameters<typeof selectActivities>[0];
    const picks = selectActivities(pool, a);
    expect(picks).toHaveLength(6);
    expect(new Set(picks.map((p) => pool.find((i) => i.id === p.id)!.item_type)).size).toBeGreaterThanOrEqual(3);
    expect(picks.filter((p) => pool.find((i) => i.id === p.id)!.idea_key === "x")).toHaveLength(1);
    expect(picks[0].why).toEqual(["at your level (beginner)", "suits your goal: understand the basics"]);
  });

  it("the AI prompt carries the four answers and the course list only", () => {
    const p = rankPrompt(a, { leads: "Lead response" }, [cand("leads", "Lead response")]);
    expect(p).toMatch(/^Goal: Understand the basics\nLevel: New to it\nTime per week: 120 minutes\nTopics chosen: Lead response\nInterests: home-services/);
    expect(p).not.toMatch(/learner|@|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe("the interview and the path", () => {
  it("offers topics (with or without a course) and interests from lists; a trial (Basic) path covers one subject, with why", async () => {
    const i = interviewFrom((await call(interviewRoute, "GET", "/api/v1/learn/interview")).body)!;
    expect(i.options.topics.map((t) => [t.slug, t.hasCourse])).toEqual([["leads", true], ["sales", true], ["ecom", false]]);
    expect(i.options.interests).toEqual(expect.arrayContaining(["home-services", "retail"]));
    expect(i).toMatchObject({ answers: null, skipped: false, plan: "basic" });
    ai.parse = async () => ({ stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      parsed_output: { order: [{ n: 1, why: "It matches your first topic." }, { n: 2, why: "It builds on the first." }] } });
    const saved = interviewSavedFrom((await answer({ ...ANSWERS, topics: ["leads", "sales"] })).body)!;
    expect(saved.path!.courses).toEqual([expect.objectContaining({ slug: "leads", why: expect.stringMatching(/You chose the topic "Lead response"/), weeks: 1, lastVerifiedOn: "2026-09-01" })]);
    expect(saved.path!.note).toMatch(/Your plan's path covers one subject; Pro adds more subjects/);
    expect(ai.requests).toHaveLength(1); // ordering the two matches, then cut to one subject
  });

  it("records every path change in the audit log, never the answers", async () => {
    await answer();
    expect(audit("learn.path.build")).toEqual([expect.objectContaining({ actor_account_id: LEARNER, previous_value: "0 course(s) on the path", new_value: expect.stringMatching(/^1 course\(s\)/) })]);
    expect(JSON.stringify(db.data.audit_events)).not.toMatch(/home-services|basics|beginner|120/);
  });

  it("Pro paths can span subjects, ordered by AI from the answers only, with the AI notice and the cost counted", async () => {
    pro();
    const p = interviewSavedFrom((await answer({ ...ANSWERS, goal: "apply", topics: ["leads", "sales"] })).body)!.path!;
    expect(p.courses.map((c) => c.slug)).toEqual(["sales", "leads"]);
    expect(p.courses[0].why).toMatch(/^Your goal is to apply it/);
    expect(p).toMatchObject({ method: "ai_ranked", aiNotice: expect.stringMatching(/^AI notice: Claude/) });
    const sent = promptText(ai.requests[0].params);
    expect(sent).toMatch(/Goal: Apply it in my work or projects/);
    expect(sent).not.toMatch(new RegExp(`${LEARNER}|learner@example.com|Test learner`));
    expect((ai.requests[0].params as { model: string }).model).toBe("claude-haiku-4-5");
    expect(db.data.ai_calls.at(-1)).toMatchObject({ purpose: "paths.rank", account_id: LEARNER, cost_usd: expect.any(Number) });
  });

  it("falls back to rules and says so when AI is off or the spend cap is reached", async () => {
    pro();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(interviewSavedFrom((await answer({ ...ANSWERS, topics: ["leads", "sales"] })).body)!.path).toMatchObject({ method: "rules", aiNotice: null, note: expect.stringMatching(/AI ordering is off/) });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
    vi.stubEnv("AI_DAILY_CAP_USD", "0");
    expect(interviewSavedFrom((await answer({ ...ANSWERS, topics: ["leads", "sales"] })).body)!.path).toMatchObject({ method: "rules", note: expect.stringMatching(/AI spending limit is reached/) });
  });

  it("the plan limit is enforced on the server; learners reorder, remove and add, each audited", async () => {
    await answer();
    expect(await call(addRoute, "POST", "/api/v1/learn/path/courses", "learner", { slug: "sales" })).toMatchObject({ status: 403, body: { reason: expect.stringMatching(/covers one subject/) } });
    expect((await call(addRoute, "POST", "/api/v1/learn/path/courses", "learner", { slug: "drafty" })).status).toBe(404);
    pro();
    expect(pathFrom((await call(addRoute, "POST", "/api/v1/learn/path/courses", "learner", { slug: "sales" })).body)!.courses.map((c) => c.slug)).toEqual(["leads", "sales"]);
    expect(pathFrom((await call(pathRoute, "PATCH", "/api/v1/learn/path", "learner", { order: ["sales", "leads"] })).body)!.courses.map((c) => c.slug)).toEqual(["sales", "leads"]);
    expect(pathFrom((await call(removeRoute, "DELETE", "/api/v1/learn/path/courses/sales", "learner", undefined, { slug: "sales" })).body)!.courses.map((c) => c.slug)).toEqual(["leads"]);
    expect(["learn.path.add", "learn.path.reorder", "learn.path.remove"].map((a) => audit(a).filter((e) => e.result === "completed").length)).toEqual([1, 1, 1]);
  });

  it("without a plan the answers are kept but there's no path yet; the interview can be skipped and redone", async () => {
    db.data.entitlements = [];
    expect((await call(skipRoute, "POST", "/api/v1/learn/interview/skip")).status).toBe(200);
    expect(await path()).toMatchObject({ interviewNeeded: false, skipped: true, plan: null });
    expect(interviewSavedFrom((await answer()).body)).toEqual({ path: null, reason: expect.stringMatching(/Choose a plan or start the free trial/) });
    expect((await call(skipRoute, "POST", "/api/v1/learn/interview/skip")).status).toBe(409);
  });
});

describe("practice picked for the learner", () => {
  it("picks by level, goal and interests with why; a different goal picks differently; the default set is a switch away", async () => {
    await answer();
    const basics = await lesson();
    expect(basics.selection).toMatchObject({ mode: "personal", personalized: true });
    expect(basics.activities.find((x) => x.type === "multiple_choice")!.why).toEqual(["at your level (beginner)", "suits your goal: understand the basics", "matches your interest: home-services"]);
    expect(basics.activities.some((x) => x.type === "flashcard")).toBe(false); // same idea as the multiple choice
    expect(new Set(basics.activities.map((x) => x.type)).size).toBeGreaterThanOrEqual(3);
    await answer({ ...ANSWERS, goal: "apply", level: "intermediate" });
    const apply = await lesson();
    expect(apply.activities.map((x) => x.id)).not.toEqual(basics.activities.map((x) => x.id));
    expect(apply.activities[0]).toMatchObject({ type: "build_it", why: expect.arrayContaining(["suits your goal: apply it in my work or projects"]) });
    expect(activityModeFrom((await call(modeRoute, "PUT", "/api/v1/learn/path/activities", "learner", { mode: "default" })).body)).toEqual({ mode: "default" });
    const all = await lesson();
    expect(all).toMatchObject({ selection: { mode: "default", personalized: false } });
    expect(all.activities).toHaveLength(9);
    expect(audit("learn.path.activities")[0]).toMatchObject({ previous_value: "personal", new_value: "default" });
  });
});

describe("gaps and the Course Admin queue", () => {
  it("a chosen topic with no course becomes an anonymous request; the learner is told plainly", async () => {
    pro();
    const p = interviewSavedFrom((await answer({ ...ANSWERS, topics: ["leads", "ecom"] })).body)!.path!;
    expect(p.note).toMatch(/No reviewed course exists yet for "E-commerce Operations"; the request was passed on to the course team, without your name/);
    expect(db.data.course_requests).toEqual([expect.objectContaining({ topic: "E-commerce Operations", topic_key: "ecom", level: "beginner", request_count: 1 })]);
    expect(Object.keys(db.data.course_requests[0]).filter((k) => /account|email|name/.test(k))).toEqual([]);
    expect(audit("course_requests.add")).toEqual([expect.objectContaining({ actor_account_id: null, actor_label: "System (Anonymous course request)" })]);
  });

  it("a typed topic request is anonymous, refuses personal details, and points to an existing course", async () => {
    const r = courseRequestFrom((await call(requestRoute, "POST", "/api/v1/learn/course-requests", "learner", { topic: "Beekeeping basics", level: "beginner" })).body)!;
    expect(r).toEqual({ recorded: true, message: 'No reviewed course on "Beekeeping basics" exists yet. Your request was passed on to the course team, without your name.' });
    await call(requestRoute, "POST", "/api/v1/learn/course-requests", "support", { topic: "beekeeping  basics", level: "beginner" });
    expect(db.data.course_requests).toEqual([expect.objectContaining({ topic_key: "beekeeping-basics", request_count: 2 })]);
    expect(JSON.stringify(db.data.audit_events.filter((e) => e.action === "course_requests.add"))).not.toMatch(new RegExp(`${LEARNER}|${ROLE_ID.support}`));
    expect((await call(requestRoute, "POST", "/api/v1/learn/course-requests", "learner", { topic: "email me at sam@example.com", level: "beginner" })).body.reason).toMatch(/Leave out personal details/);
    expect(courseRequestFrom((await call(requestRoute, "POST", "/api/v1/learn/course-requests", "learner", { topic: "Lead response", level: "beginner" })).body)).toMatchObject({ recorded: false, existing: { slug: "leads" } });
  });

  it("Course Admins (and the Owner) see and decide the queue, with a reason; others can't", async () => {
    await call(requestRoute, "POST", "/api/v1/learn/course-requests", "learner", { topic: "Beekeeping basics", level: "beginner" });
    const list = requestsFrom((await call(queueRoute, "GET", "/api/v1/course-requests?status=open", "courseAdmin")).body)!;
    expect(list).toEqual([expect.objectContaining({ topic: "Beekeeping basics", level: "beginner", count: 1, status: "open" })]);
    expect((await call(queueRoute, "GET", "/api/v1/course-requests", "reviewer")).status).toBe(403);
    const id = list[0].id;
    expect((await call(decideRoute, "POST", `/api/v1/course-requests/${id}/decide`, "courseAdmin", { status: "planned" }, { id })).status).toBe(400);
    expect(requestDecidedFrom((await call(decideRoute, "POST", `/api/v1/course-requests/${id}/decide`, "courseAdmin", { status: "planned", reason: "Queued in the catalog" }, { id })).body)).toEqual({ id, status: "planned" });
    expect(audit("course_requests.manage").at(-1)).toMatchObject({ actor_account_id: ROLE_ID.courseAdmin, previous_value: "open", new_value: "planned", reason: "Queued in the catalog", result: "completed" });
  });
});

describe("privacy", () => {
  it("the answers and the path are in the learner's download, and the learner can delete them", async () => {
    await answer();
    const exported = (await call(exportRoute, "POST", "/api/v1/privacy/export", "learner", {})).body as { data: { interview: unknown[]; path: { courses: unknown[] } } };
    expect(exported.data.interview).toEqual([expect.objectContaining({ goal: "basics", level: "beginner", minutes_per_week: 120, topics: ["leads"], interests: ["home-services"] })]);
    expect(exported.data.path.courses).toHaveLength(1);
    expect((await call(interviewRoute, "DELETE", "/api/v1/learn/interview")).status).toBe(200);
    expect(db.data.learner_interviews).toEqual([]);
    expect(db.data.learner_path_items).toEqual([]);
    expect(await path()).toMatchObject({ interviewNeeded: true, courses: [] });
  });
});
