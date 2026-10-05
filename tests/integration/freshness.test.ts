/**
 * L3 against real Postgres behind PostgREST: the freshness cycle through the real routes and the real cron handler,
 * with only the Anthropic SDK and the sources' web pages stubbed. A published course is refreshed: its sources are
 * re-checked (one is gone), the research pass proposes a new source and a market signal, the change report suggests a
 * cited edit; a Reviewer approves it into a NEW Draft (learners keep the published version), it is reviewed and
 * published, and the learner who studied v1 sees "updated" and switches without losing progress. Then the spend cap
 * makes the next course wait, and says why. Every response the pages read goes through the page's reader.
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

import * as cronRoute from "@/app/api/cron/refresh/route";
import * as refreshRoute from "@/app/api/v1/courses/[slug]/refresh/route";
import * as editRoute from "@/app/api/v1/courses/[slug]/refresh/edits/[id]/route";
import * as closeRoute from "@/app/api/v1/courses/[slug]/refresh/reports/[id]/close/route";
import * as courseRoute from "@/app/api/v1/courses/[slug]/route";
import * as coursesRoute from "@/app/api/v1/courses/route";
import * as submitRoute from "@/app/api/v1/courses/[slug]/versions/[id]/submit/route";
import * as verifyRoute from "@/app/api/v1/courses/[slug]/versions/[id]/verify/route";
import * as publishRoute from "@/app/api/v1/courses/[slug]/versions/[id]/publish/route";
import * as approveSourceRoute from "@/app/api/v1/sources/[id]/approve/route";
import * as learnCoursesRoute from "@/app/api/v1/learn/courses/route";
import * as learnLessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import * as progressRoute from "@/app/api/v1/learn/lessons/[id]/progress/route";
import { courseDetailFrom, coursesFrom, learnerCoursesFrom, learnerLessonFrom } from "@/app/courses-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
const slug = "mkt";
let lessonId = "";
let v1 = "";

const PAGES: Record<string, Response | (() => Response)> = {
  "https://example.org/speed": () => new Response("<html><body><p>Respond to new leads within five minutes. Speed wins deals.</p></body></html>", { headers: { "content-type": "text/html" } }),
  "https://example.com/old": () => new Response("not found", { status: 404 }),
};

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
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const page = PAGES[url];
    return page ? Promise.resolve(typeof page === "function" ? page() : page) : realFetch(input, init);
  });
  ai.reset();

  // A published course: one lesson citing two approved sources; the learner has completed v1.
  const academy = (await q("insert into public.academies (slug, name) values ($1, 'Lead response') returning id", [slug])).rows[0].id;
  const course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
  const mod = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Speed') returning id", [course])).rows[0].id;
  lessonId = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Why minutes matter') returning id", [mod])).rows[0].id;
  const src = async (url: string, title: string, quote: string) => {
    const id = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at, last_checked_at)
      values ($1, 'web', $2, 'approved', $3, now() - interval '60 days', now() - interval '60 days') returning id`, [title, url, ROLE_ID.reviewer])).rows[0].id as string;
    await q("select public.put_source_chunks($1, $2::jsonb)", [id, JSON.stringify([{ position: 0, text: quote, quote }])]);
    return id;
  };
  const speed = await src("https://example.org/speed", "Speed to lead study", "Respond to new leads within five minutes.");
  const old = await src("https://example.com/old", "Email follow-up guide", "Follow up by email three times in a week.");
  const body = { summary: "Why speed matters.", sections: [{ heading: "Speed", paragraphs: [
    { text: "Reply to new leads within five minutes.", refs: [1] },
    { text: "Follow up by email three times in the first week.", refs: [2] },
  ] }], takeaways: [{ text: "Be fast.", refs: [1] }] };
  const citations = [
    { ref: 1, sourceId: speed, title: "Speed to lead study", url: "https://example.org/speed", license: "web_summarize_only", lastChecked: "2026-08-01" },
    { ref: 2, sourceId: old, title: "Email follow-up guide", url: "https://example.com/old", license: "web_summarize_only", lastChecked: "2026-08-01" },
  ];
  v1 = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, last_verified_on, created_by_account_id)
    values ($1, $2, 1, 'Why minutes matter', $3, $4, '2026-08-01', $5) returning id`, [lessonId, course, JSON.stringify(body), JSON.stringify(citations), ROLE_ID.owner])).rows[0].id;
  await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v1, ROLE_ID.owner]);
  await q("update public.lesson_versions set verified_at = now() - interval '50 days', verified_by_account_id = $2 where id = $1", [v1, ROLE_ID.reviewer]);
  await q("update public.lesson_versions set status = 'published', published_at = now() - interval '50 days', published_by_account_id = $2 where id = $1", [v1, ROLE_ID.owner]);
  await q(`insert into public.progress_records (account_id, module_id, lesson_id, lesson_version_id, status, percent, completed_at)
    values ($1, $2, $3, $4, 'complete', 100, now())`, [ROLE_ID.learner, mod, lessonId, v1]);
}, 60_000);
afterAll(() => { vi.unstubAllGlobals(); return stack?.stop(); });

type Mod = Record<string, unknown>;
async function call(mod: Mod, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
const cron = async (auth?: string) => {
  const res = await cronRoute.GET(new Request("https://ascentra.test/api/cron/refresh", { headers: auth ? { authorization: auth } : {} }));
  return { status: res.status, body: await res.json() };
};
const detail = async (role: RoleKey = "reviewer") => courseDetailFrom((await call(courseRoute, "GET", `/api/v1/courses/${slug}`, role, undefined, { slug })).body)!;

const cite = (url: string, title: string, cited: string) => ({ type: "web_search_result_location", url, title, cited_text: cited, encrypted_index: "i" });
const refreshAnswer = () => ({
  stop_reason: "end_turn",
  usage: { input_tokens: 9000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
  content: [
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://example.net/sms", title: "Text-first follow-up", page_age: "September 2026", encrypted_content: "e" }] },
    { type: "text", text: "## Changed\n- ", citations: null },
    { type: "text", text: "Teams now follow up by text message first", citations: [cite("https://example.net/sms", "Text-first follow-up", "SMS follow-ups get replies faster than email")] },
    { type: "text", text: "\n## Outdated\n- Email-only follow-up -> text-first follow-up: replies are faster\n## Pace of change\n- ", citations: null },
    { type: "text", text: "Several new texting tools appeared this year", citations: [cite("https://example.net/sms", "Text-first follow-up", "several new texting tools")] },
    { type: "text", text: "\n- Overall: changing quickly, new tools and terms within a year", citations: null },
  ],
});

describe("L3 on the real database", () => {
  it("the Owner sets the refresh interval (30 to 60 days); nobody else can", async () => {
    expect((await call(refreshRoute, "PATCH", `/api/v1/courses/${slug}/refresh`, "owner", { days: 29, reason: "Fast-moving field" }, { slug })).status).toBe(400);
    expect((await call(refreshRoute, "PATCH", `/api/v1/courses/${slug}/refresh`, "courseAdmin", { days: 30, reason: "Fast-moving field" }, { slug })).status).toBe(403);
    expect((await call(refreshRoute, "PATCH", `/api/v1/courses/${slug}/refresh`, "owner", { days: 30, reason: "Fast-moving field" }, { slug })).status).toBe(200);
    const d = await detail();
    expect(d.freshness).toMatchObject({ days: 30, due: true, status: "idle" });
    expect(d.modules[0].lessons[0].stale).toBe(true);
    expect(coursesFrom((await call(coursesRoute, "GET", "/api/v1/courses", "owner")).body)?.[0].freshness).toMatchObject({ days: 30, due: true, staleLessons: [lessonId] });
  });

  it("the job needs the secret; it re-checks sources, researches, and writes a change report without touching what learners see", async () => {
    expect((await call(refreshRoute, "POST", `/api/v1/courses/${slug}/refresh`, "reviewer", {}, { slug })).body).toMatchObject({ queued: true, estimateUsd: 0.27 });
    expect((await detail()).freshness.status).toBe("queued");
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer wrong")).status).toBe(401);

    ai.create = async () => refreshAnswer();
    ai.parse = async (p) => {
      const text = promptText(p);
      const sms = Number(/^E(\d+) \[Text-first follow-up\]/m.exec(text)![1]);
      expect(text).toMatch(/^L1\.S1\.P2: Follow up by email three times in the first week\.$/m);
      expect(text).toMatch(/Email follow-up guide: gone/);
      return {
        stop_reason: "end_turn", usage: { input_tokens: 5000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        parsed_output: {
          doubtful: [{ paragraph: "L1.S1.P2", kind: "outdated", reason: "Email-only follow-up is giving way to text." }],
          edits: [{ paragraph: "L1.S1.P2", newText: "Follow up by text message first, then by email, in the first week.", evidence: [sms], reason: "Text follow-ups now get faster replies" }],
        },
      };
    };
    const run = await cron(`Bearer ${TEST_ENV.CRON_SECRET}`);
    expect(run).toMatchObject({ status: 200, body: { ran: 1, results: [{ course: slug, status: "ready" }] } });

    const d = await detail();
    const report = d.reports[0];
    expect(report).toMatchObject({ status: "ready", trigger: "manual", marketSignal: { pace: "quick" } });
    expect(report.sourceChecks.map((c) => [c.title, c.result])).toEqual(expect.arrayContaining([["Speed to lead study", "ok"], ["Email follow-up guide", "gone"]]));
    expect(report.newSources).toEqual([expect.objectContaining({ title: "Text-first follow-up", status: "proposed" })]);
    expect(report.doubtful.map((x) => [x.paragraph, x.kind])).toEqual([["S1.P2", "source_problem"]]);
    expect(report.edits).toEqual([expect.objectContaining({ location: "S1.P2", status: "suggested", sources: [expect.objectContaining({ title: "Text-first follow-up", status: "proposed" })] })]);
    expect(d.freshness.status).toBe("idle");
    // Nothing changed for learners.
    expect((await q("select status from public.lesson_versions where lesson_id = $1", [lessonId])).rows).toEqual([{ status: "published" }]);
    const l = learnerLessonFrom((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, "learner", undefined, { id: lessonId })).body);
    expect(l).toMatchObject({ lesson: { version: { id: v1, number: 1, lastVerifiedOn: "2026-08-01" } }, update: null });
  });

  it("a Reviewer approves the edit into a NEW Draft; it is reviewed and published like any version", async () => {
    let d = await detail();
    const edit = d.reports[0].edits[0];
    expect((await call(editRoute, "POST", `/api/v1/courses/${slug}/refresh/edits/${edit.id}`, "courseAdmin", { decision: "approve" }, { slug, id: edit.id })).status).toBe(403);
    const ok = await call(editRoute, "POST", `/api/v1/courses/${slug}/refresh/edits/${edit.id}`, "reviewer", { decision: "approve" }, { slug, id: edit.id });
    expect(ok).toMatchObject({ status: 200, body: { status: "approved", draftVersionId: expect.any(String) } });
    d = await detail();
    const versions = d.modules[0].lessons[0].versions;
    const v2 = versions.find((v) => v.version === 2)!;
    expect(v2).toMatchObject({ status: "draft", fromRefresh: true, diffAgainst: 1, changeSummary: "Updated: Text follow-ups now get faster replies." });
    expect(v2.diff).toEqual(expect.arrayContaining([
      { op: "remove", text: "Follow up by email three times in the first week. [2]" },
      { op: "add", text: "Follow up by text message first, then by email, in the first week. [2]" },
    ]));
    expect(versions.find((v) => v.version === 1)!.status).toBe("published");

    const p = { slug, id: v2.id };
    expect((await call(submitRoute, "POST", `/api/v1/courses/${slug}/versions/${v2.id}/submit`, "owner", {}, p)).status).toBe(200);
    expect((await call(verifyRoute, "POST", `/api/v1/courses/${slug}/versions/${v2.id}/verify`, "reviewer", { decision: "verify", note: "Checked the new source and the edit" }, p)).status).toBe(200);
    // The new source is still proposed: publishing waits for its approval.
    expect((await call(publishRoute, "POST", `/api/v1/courses/${slug}/versions/${v2.id}/publish`, "owner", { reason: "Refresh reviewed" }, p)).status).toBe(409);
    const newSource = d.reports[0].newSources[0].id;
    expect((await call(approveSourceRoute, "POST", `/api/v1/sources/${newSource}/approve`, "reviewer", { reason: "Checked the page and its date" }, { id: newSource })).status).toBe(200);
    expect((await call(publishRoute, "POST", `/api/v1/courses/${slug}/versions/${v2.id}/publish`, "owner", { reason: "Refresh reviewed" }, p)).status).toBe(200);
  });

  it("the learner who studied v1 sees 'updated' with its summary, and switches without losing progress", async () => {
    expect(learnerCoursesFrom((await call(learnCoursesRoute, "GET", "/api/v1/learn/courses", "learner")).body)?.[0].modules[0].lessons[0]).toMatchObject({ done: true, updated: true });
    const before = learnerLessonFrom((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, "learner", undefined, { id: lessonId })).body)!;
    expect(before.lesson.version).toMatchObject({ id: v1, number: 1, lastVerifiedOn: "2026-08-01" });
    expect(before.update).toMatchObject({ number: 2, summary: "Updated: Text follow-ups now get faster replies." });
    const current = learnerLessonFrom((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}?view=current`, "learner", undefined, { id: lessonId })).body)!;
    expect(current.lesson.version.number).toBe(2);
    expect(current.lesson.version.lastVerifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect((await call(progressRoute, "POST", `/api/v1/learn/lessons/${lessonId}/progress`, "learner", { versionId: before.update!.versionId, status: "in_progress", carry: true }, { id: lessonId })).body).toMatchObject({ status: "complete" });
    const after = learnerLessonFrom((await call(learnLessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, "learner", undefined, { id: lessonId })).body)!;
    expect(after).toMatchObject({ lesson: { version: { number: 2 } }, update: null, progress: { status: "complete" } });
    expect((await q("select v.version, p.status from public.progress_records p join public.lesson_versions v on v.id = p.lesson_version_id where p.account_id = $1 order by v.version", [ROLE_ID.learner])).rows)
      .toEqual([{ version: 1, status: "complete" }, { version: 2, status: "complete" }]);
  });

  it("closing the report verifies the course; when the spend cap is reached the next run waits and says why", async () => {
    const report = (await detail()).reports[0];
    expect((await call(closeRoute, "POST", `/api/v1/courses/${slug}/refresh/reports/${report.id}/close`, "reviewer", { note: "Edit approved and published; the rest is accurate" }, { slug, id: report.id })).status).toBe(200);
    const d = await detail();
    expect(d.freshness).toMatchObject({ due: false, staleLessons: [] });
    expect(new Date(d.freshness.lastVerifiedAt!).toDateString()).toBe(new Date().toDateString());

    vi.stubEnv("AI_DAILY_CAP_USD", "0.05");
    expect((await call(refreshRoute, "POST", `/api/v1/courses/${slug}/refresh`, "owner", {}, { slug })).status).toBe(200);
    expect((await cron(`Bearer ${TEST_ENV.CRON_SECRET}`)).body).toMatchObject({ ran: 0, results: [{ course: slug, status: "waiting_cap" }] });
    expect((await detail("owner")).freshness).toMatchObject({ status: "waiting_cap", note: expect.stringMatching(/^Waiting for the next nightly run: today's AI spend cap/) });
    vi.stubEnv("AI_DAILY_CAP_USD", "");

    // A run the platform cut off (still "running" after 15 minutes) doesn't block the course: it is marked failed and runs again.
    const academy = (await q("select id from public.academies where slug = $1", [slug])).rows[0].id;
    const stuck = (await q("insert into public.refresh_runs (academy_id, trigger, status, started_at) values ($1, 'scheduled', 'running', now() - interval '1 hour') returning id", [academy])).rows[0].id;
    ai.parse = async () => ({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, parsed_output: { doubtful: [], edits: [] } });
    const again = await cron(`Bearer ${TEST_ENV.CRON_SECRET}`);
    expect(again.body, JSON.stringify(again.body)).toMatchObject({ results: [{ course: slug, status: "ready" }] });
    expect((await q("select status, error from public.refresh_runs where id = $1", [stuck])).rows[0]).toEqual({ status: "failed", error: "Stopped before it finished (time limit). It will run again." });

    expect((await q("select * from public.audit_verify_chain()")).rows[0]).toMatchObject({ ok: true });
    const actions = (await q("select action from public.audit_events where action like 'courses.refresh%' order by seq")).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["courses.refresh.configure", "courses.refresh.run", "courses.refresh.edit", "courses.refresh.review"]));
    expect(JSON.stringify((await q("select * from public.ai_calls")).rows)).not.toMatch(/text message|email/i);
  });
});
