/**
 * L2 against real Postgres (with pgvector) behind PostgREST: the whole flow through the real routes, with only the
 * Anthropic SDK replaced (tests/fixtures/anthropic-mock): research → approve the proposed sources → Blueprint →
 * approve it → draft a lesson → submit → a Reviewer verifies → publish → a learner reads it with its citations and
 * "last verified" date, and progress points to the version read. Every response the pages read is passed through
 * the page's reader (app/courses-api.ts), so the pages are tested against the real response shapes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, passagesMatching, promptText, researchAnswer } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as researchRoute from "@/app/api/v1/sources/research/route";
import * as sourcesRoute from "@/app/api/v1/sources/route";
import * as approveSourceRoute from "@/app/api/v1/sources/[id]/approve/route";
import * as coursesRoute from "@/app/api/v1/courses/route";
import * as estimateRoute from "@/app/api/v1/courses/estimate/route";
import * as courseRoute from "@/app/api/v1/courses/[slug]/route";
import * as blueprintsRoute from "@/app/api/v1/courses/[slug]/blueprints/route";
import * as blueprintRoute from "@/app/api/v1/courses/[slug]/blueprints/[id]/route";
import * as approveBlueprintRoute from "@/app/api/v1/courses/[slug]/blueprints/[id]/approve/route";
import * as draftRoute from "@/app/api/v1/courses/[slug]/lessons/[id]/draft/route";
import * as submitRoute from "@/app/api/v1/courses/[slug]/versions/[id]/submit/route";
import * as verifyRoute from "@/app/api/v1/courses/[slug]/versions/[id]/verify/route";
import * as publishRoute from "@/app/api/v1/courses/[slug]/versions/[id]/publish/route";
import * as learnCoursesRoute from "@/app/api/v1/learn/courses/route";
import * as learnLessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import * as progressRoute from "@/app/api/v1/learn/lessons/[id]/progress/route";
import * as meRoute from "@/app/api/v1/me/route";
import {
  courseDetailFrom, coursesFrom, estimateFrom, learnerCoursesFrom, learnerLessonFrom, librarySourcesFrom, researchResultFrom, researchRunsFrom,
} from "@/app/courses-api";
import { meFrom } from "@/app/me";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  ai.reset();
}, 60_000);
afterAll(() => stack?.stop());

type Mod = Record<string, unknown>;
async function call(mod: Mod, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}

const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

describe("L2 on the real database", () => {
  const slug = "mkt"; // assigned to the seeded Course Admin and Reviewer
  let lessonId = "";
  let versionId = "";

  it("research → approve its sources → Blueprint → approve → draft → review → publish → a learner reads it", async () => {
    // The pages read who is signed in through meFrom.
    expect(meFrom((await call(meRoute, "GET", "/api/v1/me", "reviewer")).body)?.roleKey).toBe("reviewer");

    // 1. Research: proposed sources and claims, with outdated notes.
    ai.create = async () => researchAnswer();
    const run = await call(researchRoute, "POST", "/api/v1/sources/research", "owner", { topic: "Lead response time", audience: "beginner" });
    expect(researchResultFrom(run.body)).toMatchObject({ sources: 2, newSources: 2, claims: 3, uncited: 1, outdated: 1 });
    const runs = researchRunsFrom((await call(researchRoute, "GET", "/api/v1/sources/research", "reviewer")).body);
    expect(runs?.[0]).toMatchObject({ topic: "Lead response time", outdated: [{ item: "Bought lead lists", replacedBy: "instant routing of inbound forms" }] });
    expect(runs?.[0].sources.every((s) => s.status === "proposed")).toBe(true);

    // Proposed sources can't be used for a Blueprint.
    const ids = runs![0].sources.map((s) => s.id);
    const bpBody = { title: "Lead response", topic: "Lead response time", audience: "beginner", sourceIds: ids, researchRunIds: [runs![0].id] };
    expect((await call(blueprintsRoute, "POST", `/api/v1/courses/${slug}/blueprints`, "owner", bpBody, { slug })).status).toBe(409);

    // 2. A Reviewer approves them (L1).
    for (const id of ids) {
      expect((await call(approveSourceRoute, "POST", `/api/v1/sources/${id}/approve`, "reviewer", { reason: "Checked the source and its date" }, { id })).status).toBe(200);
    }
    const approved = librarySourcesFrom((await call(sourcesRoute, "GET", "/api/v1/sources?status=approved", "courseAdmin")).body);
    expect(approved?.map((s) => s.id).sort()).toEqual([...ids].sort());

    // 3. The estimate, then the Blueprint (Sonnet 5.5), from approved sources only.
    const est = estimateFrom((await call(estimateRoute, "GET", "/api/v1/courses/estimate?lessons=2", "courseAdmin")).body);
    expect(est).toMatchObject({ aiOn: true, course: { blueprint: 0.15, perLesson: 0.14 } });
    ai.parse = async (p) => {
      const text = promptText(p);
      const fast = passagesMatching(text, /five minutes/);
      const hour = passagesMatching(text, /same-hour/);
      expect(text).toMatch(/Outdated, according to the research:\n- Bought lead lists -> instant routing of inbound forms/);
      return {
        stop_reason: "end_turn", usage: usage(6000, 2500),
        parsed_output: { title: "Lead response", outcome: "Answer new leads fast enough to win them", modules: [{
          title: "Speed to lead", stage: "Foundations", skills: [{ name: "Response time" }],
          lessons: [
            { title: "Why minutes matter", minutes: 12, objectives: ["Explain the drop-off"], keyClaims: [{ claim: "Reply within five minutes.", passages: fast }, { claim: "Leads cool quickly.", passages: [] }] },
            { title: "When an hour is enough", minutes: 10, objectives: ["Pick a target"], keyClaims: [{ claim: "Same-hour replies work for service businesses.", passages: hour }] },
          ],
        }] },
      };
    };
    const bp = await call(blueprintsRoute, "POST", `/api/v1/courses/${slug}/blueprints`, "courseAdmin", bpBody, { slug });
    expect(bp).toMatchObject({ status: 201, body: { modules: 1, lessons: 2, uncitedClaims: 1, outdated: 1 } });
    expect((ai.requests.at(-1)!.params as { model: string }).model).toBe("claude-sonnet-5-5");

    let detail = courseDetailFrom((await call(courseRoute, "GET", `/api/v1/courses/${slug}`, "reviewer", undefined, { slug })).body);
    expect(detail).not.toBeNull();
    const draftBp = detail!.blueprints[0];
    expect(draftBp).toMatchObject({ status: "draft", generatedBy: "ai", outdated: [{ item: "Bought lead lists" }] });
    expect(draftBp.plan.modules[0].lessons[0].keyClaims).toEqual([
      expect.objectContaining({ claim: "Reply within five minutes.", sourceId: expect.any(String), quote: "Respond to new leads within five minutes." }),
      { claim: "Leads cool quickly.", sourceId: null },
    ]);
    expect(coursesFrom((await call(coursesRoute, "GET", "/api/v1/courses", "courseAdmin")).body)).toEqual([
      expect.objectContaining({ slug, blueprints: { draft: 1, approved: 0 }, versions: [] }),
    ]);

    // A person edits it (renames a lesson), then approves it: a Draft course version, no lesson written yet.
    const plan = structuredClone(draftBp.plan);
    plan.modules[0].lessons[1].title = "When a same-hour reply is enough";
    expect((await call(blueprintRoute, "PATCH", `/api/v1/courses/${slug}/blueprints/${draftBp.id}`, "courseAdmin", { plan }, { slug, id: draftBp.id })).status).toBe(200);
    const okBp = await call(approveBlueprintRoute, "POST", `/api/v1/courses/${slug}/blueprints/${draftBp.id}/approve`, "courseAdmin", {}, { slug, id: draftBp.id });
    expect(okBp).toMatchObject({ status: 200, body: { lessons: 2 } });
    detail = courseDetailFrom((await call(courseRoute, "GET", `/api/v1/courses/${slug}`, "owner", undefined, { slug })).body);
    expect(detail!.current).toMatchObject({ version: 1, status: "draft" });
    expect(detail!.modules[0].lessons.map((l) => [l.title, l.versions.length])).toEqual([["Why minutes matter", 0], ["When a same-hour reply is enough", 0]]);
    lessonId = detail!.modules[0].lessons[0].id;

    // 4. Draft the lesson: the course context goes as a cached block; citations are real sources.
    ai.parse = async (p) => {
      const text = promptText(p);
      return {
        stop_reason: "end_turn", usage: usage(4000, 3000),
        parsed_output: {
          summary: "Why replying fast wins leads.",
          sections: [{ heading: "The first five minutes", paragraphs: [
            { text: "Studies of inbound leads find the first few minutes matter most.", passages: passagesMatching(text, /five minutes/) },
            { text: "Many service businesses do fine replying within the hour.", passages: passagesMatching(text, /same-hour/) },
            { text: "Set a target your team can keep every day.", passages: [] },
          ] }],
          takeaways: [{ text: "Reply fast; within five minutes if you can.", passages: passagesMatching(text, /five minutes/) }],
        },
      };
    };
    const d = await call(draftRoute, "POST", `/api/v1/courses/${slug}/lessons/${lessonId}/draft`, "courseAdmin", {}, { slug, id: lessonId });
    expect(d).toMatchObject({ status: 201, body: { version: 1, citations: 2, uncited: 1, removed: 0, lastVerifiedOn: expect.any(String) } });
    versionId = d.body.id;
    const draftReq = ai.requests.at(-1)!.params as { system: { cache_control?: unknown }[] };
    expect(draftReq.system[1].cache_control).toEqual({ type: "ephemeral" });

    // Nothing unpublished reaches learners, whoever asks.
    for (const who of ["learner", "owner"] as const) {
      expect((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, who, undefined, { id: lessonId })).status).toBe(404);
      expect(learnerCoursesFrom((await call(learnCoursesRoute, "GET", "/api/v1/learn/courses", who)).body)).toEqual([]);
    }

    // 5. Review: submit; publishing before verification is refused; the Reviewer verifies; the Owner publishes.
    const vParams = { slug, id: versionId };
    expect((await call(submitRoute, "POST", `/api/v1/courses/${slug}/versions/${versionId}/submit`, "courseAdmin", {}, vParams)).status).toBe(200);
    expect((await call(publishRoute, "POST", `/api/v1/courses/${slug}/versions/${versionId}/publish`, "owner", { reason: "Ready for learners" }, vParams)).status).toBe(409);
    expect((await call(verifyRoute, "POST", `/api/v1/courses/${slug}/versions/${versionId}/verify`, "courseAdmin", { decision: "verify", note: "Looks right" }, vParams)).status).toBe(403);
    expect((await call(verifyRoute, "POST", `/api/v1/courses/${slug}/versions/${versionId}/verify`, "reviewer", { decision: "verify", note: "Opened both citations; they match" }, vParams)).status).toBe(200);
    expect((await call(publishRoute, "POST", `/api/v1/courses/${slug}/versions/${versionId}/publish`, "owner", {}, vParams)).status).toBe(400);
    expect((await call(publishRoute, "POST", `/api/v1/courses/${slug}/versions/${versionId}/publish`, "owner", { reason: "Verified and ready" }, vParams)).status).toBe(200);
    expect((await q("select status from public.courses where id = $1", [detail!.current!.id])).rows[0].status).toBe("published");

    // 6. A learner reads it: citations and "last verified"; the paragraph with no source is marked.
    const courses = learnerCoursesFrom((await call(learnCoursesRoute, "GET", "/api/v1/learn/courses", "learner")).body);
    expect(courses).toEqual([expect.objectContaining({ slug, modules: [{ title: "Speed to lead", lessons: [expect.objectContaining({ id: lessonId, title: "Why minutes matter", done: false })] }] })]);
    const lesson = learnerLessonFrom((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, "learner", undefined, { id: lessonId })).body);
    expect(lesson).not.toBeNull();
    expect(lesson!.lesson.version).toMatchObject({ id: versionId, number: 1, uncited: 1, lastVerifiedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(lesson!.lesson.version.citations.map((c) => c.title).sort()).toEqual(["Service desk guide", "Speed to lead study"]);
    expect(lesson!.lesson.version.body.sections[0].paragraphs[2]).toEqual({ text: "Set a target your team can keep every day.", refs: [] });

    // Progress points to the version read.
    expect((await call(progressRoute, "POST", `/api/v1/learn/lessons/${lessonId}/progress`, "learner", { versionId, status: "complete" }, { id: lessonId })).status).toBe(200);
    expect((await q("select lesson_version_id, status from public.progress_records where account_id = $1", [ROLE_ID.learner])).rows).toEqual([{ lesson_version_id: versionId, status: "complete" }]);
  });

  it("a new version is a new Draft with a diff; learners keep the published one until it is published", async () => {
    ai.parse = async () => ({
      stop_reason: "end_turn", usage: usage(4000, 3000),
      parsed_output: { summary: "Why replying fast wins leads.", sections: [{ heading: "The first five minutes", paragraphs: [{ text: "Reply within minutes, not hours.", passages: [] }] }], takeaways: [] },
    });
    const slug = "mkt";
    const d = await call(draftRoute, "POST", `/api/v1/courses/${slug}/lessons/${lessonId}/draft`, "owner", {}, { slug, id: lessonId });
    expect(d).toMatchObject({ status: 201, body: { version: 2 } });
    const detail = courseDetailFrom((await call(courseRoute, "GET", `/api/v1/courses/${slug}`, "reviewer", undefined, { slug })).body);
    const v2 = detail!.modules[0].lessons[0].versions.find((v) => v.version === 2)!;
    expect(v2).toMatchObject({ status: "draft", diffAgainst: 1 });
    expect(v2.diff).toEqual(expect.arrayContaining([{ op: "add", text: "Reply within minutes, not hours. [no source]" }, expect.objectContaining({ op: "remove" })]));
    const lesson = learnerLessonFrom((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, "learner", undefined, { id: lessonId })).body);
    expect(lesson!.lesson.version.number).toBe(1);
  });

  it("keeps Course Admins and Reviewers to their assigned courses, and the audit chain intact", async () => {
    const body = { title: "Sales", topic: "Sales basics", audience: "beginner", sourceIds: [] };
    expect((await call(blueprintsRoute, "POST", "/api/v1/courses/sales/blueprints", "courseAdmin", { ...body, sourceIds: ["00000000-0000-4000-8000-000000000001"] }, { slug: "sales" })).body.reason)
      .toBe("You can only work on courses assigned to you.");
    expect((await call(courseRoute, "GET", "/api/v1/courses/sales", "reviewer", undefined, { slug: "sales" })).status).toBe(404);
    const actions = (await q("select action from public.audit_events where action like 'courses.%' or action = 'sources.research' order by seq")).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["sources.research", "courses.blueprint.generate", "courses.blueprint.edit", "courses.blueprint.approve",
      "courses.lesson.draft", "courses.lesson.submit", "courses.lesson.verify", "courses.release"]));
    expect((await q("select * from public.audit_verify_chain()")).rows[0]).toMatchObject({ ok: true });
    // The model call log holds no prompt or lesson text.
    const calls = JSON.stringify((await q("select * from public.ai_calls")).rows);
    expect(calls).not.toMatch(/five minutes|Lead response|same-hour/i);
  });
});
