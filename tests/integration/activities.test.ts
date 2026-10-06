/**
 * L6 against real Postgres behind PostgREST: the activity library and batch generation through the real routes and the
 * real cron handler, with only the Anthropic SDK stubbed. A pool is drafted for a published lesson, reviewed, held back
 * by the variety rule, then published; a learner sees only published items, gets a graded item graded at once with a
 * cited explanation and a practice item labeled not graded; a Reviewer sees the misses without names. A queued topic
 * goes research -> source approval -> Blueprint -> Blueprint approval -> lesson and pool drafts -> waiting for review,
 * everything as Draft. The audit chain stays intact. Every response a page reads goes through its reader.
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

import * as draftRoute from "@/app/api/v1/courses/[slug]/lessons/[id]/activities/route";
import * as libraryRoute from "@/app/api/v1/courses/[slug]/activities/route";
import * as reviewRoute from "@/app/api/v1/courses/[slug]/activities/[id]/review/route";
import * as publishRoute from "@/app/api/v1/courses/[slug]/modules/[id]/activities/publish/route";
import * as missesRoute from "@/app/api/v1/courses/[slug]/lessons/[id]/misses/route";
import * as attemptRoute from "@/app/api/v1/learn/activities/[id]/attempt/route";
import * as lessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import * as catalogRoute from "@/app/api/v1/catalog/route";
import * as queueRoute from "@/app/api/v1/catalog/queue/route";
import * as approveBpRoute from "@/app/api/v1/courses/[slug]/blueprints/[id]/approve/route";
import * as cronRoute from "@/app/api/cron/catalog/route";
import {
  attemptFrom, batchQueuedFrom, batchQuoteFrom, catalogFrom, itemStatusFrom, lessonActivitiesFrom, libraryFrom, missesFrom, modulePublishedFrom, poolDraftedFrom,
} from "@/app/activities-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
const SLUG = "mkt";
let lessonId = "";
let moduleId = "";
const usage = { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function poolFor(prompt: string) {
  const passage = passagesMatching(prompt, /five minutes/i)[0] ?? 1;
  const base = { level: "beginner", goal: "Reply to leads fast", interests: ["home-services"], passage, explanation: "The study says to respond within five minutes." };
  return { items: [
    { ...base, type: "multiple_choice", ideaKey: "reply-speed", prompt: "How fast should you reply to a new lead?", options: ["Within five minutes", "Next day"], correctIndex: 0 },
    { ...base, type: "true_false", ideaKey: "reply-speed-tf", prompt: "Leads stay warm for days.", correctBool: false },
    { ...base, type: "teach_back", ideaKey: "explain-speed", prompt: "Explain to a colleague why speed matters.", keyPoints: ["Leads cool quickly", "The first useful reply often wins"] },
  ] };
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
  ai.create = async () => researchAnswer();
  ai.parse = async (p) => {
    const text = promptText(p);
    if (text.startsWith("You write practice items")) return { stop_reason: "end_turn", usage, parsed_output: poolFor(text) };
    if (text.startsWith("You plan a course outline")) {
      return { stop_reason: "end_turn", usage, parsed_output: { title: "E-commerce Operations", outcome: "Run margin reviews.", modules: [{ title: "Speed", stage: "Foundation", skills: [{ name: "Response time" }], lessons: [{ title: "Why minutes matter", minutes: 10, objectives: ["Reply fast"], keyClaims: [{ claim: "Reply within five minutes", passages: [1] }] }] }] } };
    }
    if (text.startsWith("You write one lesson")) {
      const n = passagesMatching(text, /five minutes/i)[0] ?? 1;
      return { stop_reason: "end_turn", usage, parsed_output: { summary: "Speed wins.", sections: [{ heading: "Speed", paragraphs: [{ text: "Answer new leads quickly; the first useful reply often wins the job.", passages: [n] }] }], takeaways: [{ text: "Be quick.", passages: [n] }] } };
    }
    throw new Error("unexpected parse");
  };

  // A published lesson in the Reviewer's course, citing one approved source.
  const academy = (await q("insert into public.academies (slug, name) values ($1, 'Client Acquisition Systems') returning id", [SLUG])).rows[0].id;
  const course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
  moduleId = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Lead response') returning id", [course])).rows[0].id;
  lessonId = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Why minutes matter') returning id", [moduleId])).rows[0].id;
  const src = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
    values ('Speed to lead study', 'web', 'https://example.org/speed', 'approved', $1, now()) returning id`, [ROLE_ID.reviewer])).rows[0].id as string;
  await q("select public.put_source_chunks($1, $2::jsonb)", [src, JSON.stringify([{ position: 0, text: "Respond to new leads within five minutes.", quote: "Respond to new leads within five minutes." }])]);
  const body = { summary: "", sections: [{ heading: "Speed", paragraphs: [{ text: "Reply to new leads within five minutes.", refs: [1] }] }], takeaways: [] };
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
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const cron = async () => (await cronRoute.GET(new Request("https://ascentra.test/api/cron/catalog", { headers: { authorization: `Bearer ${TEST_ENV.CRON_SECRET}` } }))).status;
const itemIds = async (status?: string) => (await q(`select id, item_type from public.activity_items where lesson_id = $1 ${status ? "and status = $2" : ""} order by created_at`, status ? [lessonId, status] : [lessonId])).rows as { id: string; item_type: string }[];
const review = (id: string) => call(reviewRoute, "POST", `/api/v1/courses/${SLUG}/activities/${id}/review`, "reviewer", { decision: "approve", note: "Answer key and citation checked" }, { slug: SLUG, id });
const publish = () => call(publishRoute, "POST", `/api/v1/courses/${SLUG}/modules/${moduleId}/activities/publish`, "owner", { reason: "Reviewed and ready" }, { slug: SLUG, id: moduleId });
const learnerView = async () => lessonActivitiesFrom((await call(lessonRoute, "GET", `/api/v1/learn/lessons/${lessonId}`, "learner", undefined, { id: lessonId })).body)!;

describe("L6 on the real database", () => {
  it("drafts a cited pool; a Draft is invisible to learners; 2 types can't be published, 3 can", async () => {
    expect(poolDraftedFrom((await call(draftRoute, "POST", `/api/v1/courses/${SLUG}/lessons/${lessonId}/activities`, "owner", {}, { slug: SLUG, id: lessonId })).body)).toMatchObject({ drafted: 3, types: 3 });
    expect((await learnerView()).activities).toEqual([]);
    const [mc, tf, tb] = await itemIds();
    expect(itemStatusFrom((await review(mc.id)).body)).toEqual({ id: mc.id, status: "approved" });
    await review(tf.id);
    expect((await publish()).body.reason).toMatch(/at least 3 different activity types/);
    await expect(q("select public.publish_module_activities($1, $2)", [moduleId, ROLE_ID.owner])).rejects.toThrow(/at least 3 different activity types/);
    await review(tb.id);
    expect(modulePublishedFrom((await publish()).body)).toEqual({ moduleId, published: 3, types: 3 });
    const lib = libraryFrom((await call(libraryRoute, "GET", `/api/v1/courses/${SLUG}/activities`, "reviewer", undefined, { slug: SLUG })).body)!;
    expect(lib.modules[0].variety).toMatchObject({ types: 3, ok: true, publishedTypes: 3 });
  });

  it("a learner's graded item is graded at once with a cited explanation; a practice item is labeled not graded", async () => {
    const view = await learnerView();
    expect(view.activities.map((a) => [a.type, a.label])).toEqual([["multiple_choice", "Graded"], ["true_false", "Graded"], ["teach_back", "Practice, not graded"]]);
    const mc = view.activities[0];
    expect(attemptFrom((await call(attemptRoute, "POST", `/api/v1/learn/activities/${mc.id}/attempt`, "learner", { answer: { choice: 1 } }, { id: mc.id })).body))
      .toMatchObject({ graded: true, correct: false, correctAnswer: 0, citation: { title: "Speed to lead study" } });
    const tb = view.activities[2];
    expect(attemptFrom((await call(attemptRoute, "POST", `/api/v1/learn/activities/${tb.id}/attempt`, "learner", { answer: "secret words" }, { id: tb.id })).body))
      .toMatchObject({ graded: false, label: "Practice, not graded", reveal: { keyPoints: ["Leads cool quickly", "The first useful reply often wins"] } });
    const rows = (await q("select graded_by, correct, counted, answer from public.activity_attempts order by created_at")).rows;
    expect(rows).toEqual([{ graded_by: "code", correct: false, counted: true, answer: 1 }, { graded_by: "none", correct: null, counted: false, answer: null }]);
    const m = missesFrom((await call(missesRoute, "GET", `/api/v1/courses/${SLUG}/lessons/${lessonId}/misses`, "reviewer", undefined, { slug: SLUG, id: lessonId })).body)!;
    expect(m.find((x) => x.id === mc.id)).toMatchObject({ attempts: 1, correct: 0, misses: [{ answer: 1, count: 1 }] });
    expect(JSON.stringify(m)).not.toMatch(new RegExp(ROLE_ID.learner));
  });

  it("a queued topic goes research → source approval → Blueprint → approval → lesson and pool drafts → waiting for review", async () => {
    const quote = batchQuoteFrom((await call(queueRoute, "POST", "/api/v1/catalog/queue", "owner", { slugs: ["ecom"] })).body)!;
    expect(batchQueuedFrom((await call(queueRoute, "POST", "/api/v1/catalog/queue", "owner", { slugs: ["ecom"], confirm: true, expectedTotalUsd: quote.totalUsd })).body)).toMatchObject({ queued: 1 });
    expect(await cron()).toBe(200);
    const job = async () => (await q("select status, waiting_for, research_run_id, blueprint_id from public.catalog_jobs where topic_slug = 'ecom'")).rows[0];
    expect(await job()).toMatchObject({ status: "waiting", waiting_for: "source_approval" });
    await q("update public.sources set status = 'approved', approved_by_account_id = $2, approved_at = now() where research_run_id = $1", [(await job()).research_run_id, ROLE_ID.reviewer]);
    await cron();
    expect(await job()).toMatchObject({ status: "waiting", waiting_for: "blueprint_approval" });
    const bp = (await job()).blueprint_id;
    expect((await call(approveBpRoute, "POST", `/api/v1/courses/ecom/blueprints/${bp}/approve`, "owner", {}, { slug: "ecom", id: bp })).status).toBe(200);
    await cron();
    expect(await job()).toMatchObject({ status: "waiting", waiting_for: "review" });
    const drafted = (await q(`select (select count(*)::int from public.lesson_versions v join public.courses c on c.id = v.course_id join public.academies a on a.id = c.academy_id where a.slug = 'ecom' and v.status = 'draft') as lessons,
      (select count(*)::int from public.activity_items i join public.courses c on c.id = i.course_id join public.academies a on a.id = c.academy_id where a.slug = 'ecom' and i.status = 'draft') as items`)).rows[0];
    expect(drafted).toEqual({ lessons: 1, items: 3 });
    const cat = catalogFrom((await call(catalogRoute, "GET", "/api/v1/catalog", "owner")).body)!;
    expect(cat.topics.find((t) => t.slug === "ecom")).toMatchObject({ stateLabel: "In review", job: { waitingFor: "review" } });
  });

  it("audits queue, review and publish actions with previous and new values, and the chain stays intact", async () => {
    const { rows } = await q(`select action, previous_value, new_value, result from public.audit_events
      where action in ('catalog.queue', 'courses.activities.review', 'courses.activities.publish', 'catalog.job.step') order by seq`);
    expect(rows.filter((r) => r.action === "catalog.queue")).toEqual([{ action: "catalog.queue", previous_value: "not queued", new_value: "1 topic(s) queued", result: "completed" }]);
    expect(rows.filter((r) => r.action === "courses.activities.publish").map((r) => r.result)).toEqual(["blocked", "completed"]);
    expect(rows.filter((r) => r.action === "catalog.job.step").length).toBeGreaterThan(3);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });
});
