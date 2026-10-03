/**
 * L2 through the real code (database faked in memory, Clerk mocked, the Anthropic SDK replaced by tests/fixtures/
 * anthropic-mock): research with web search lands as PROPOSED sources and claims with their citations; the AI off
 * switch and the spend caps; prompts never carry secrets or personal data; the Blueprint and lesson builders keep
 * every citation, mark what has none, and drop copied paragraphs; the lesson call caches the shared course context.
 * The full flow on the real database is in tests/integration/course-generation.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, researchAnswer } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l2", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as researchRoute from "@/app/api/v1/sources/research/route";
import * as estimateRoute from "@/app/api/v1/courses/estimate/route";
import * as blueprintsRoute from "@/app/api/v1/courses/[slug]/blueprints/route";
import { parseResearch, RESEARCH_SYSTEM } from "@/lib/courses/research";
import { toPlan } from "@/lib/courses/blueprint";
import { MAX_COPIED_WORDS, diffLines, toLessonBody } from "@/lib/courses/lessons";
import { longestSharedRun } from "@/lib/courses/common";
import { structured } from "@/lib/ai";
import { courseEstimate, estimateUsd } from "@/lib/ai/config";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

type Db = ReturnType<typeof seedFake>;
let db: Db;

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  db = seedFake();
  db.data.sources = [];
  fake.db = db;
  ai.reset();
  ai.create = async () => researchAnswer();
});
afterEach(() => vi.unstubAllEnvs());

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
const research = (role: RoleKey = "owner", body: Record<string, unknown> = { topic: "Lead response time", audience: "beginner" }) =>
  call(researchRoute, "POST", "/api/v1/sources/research", role, body);

describe("research with live web search", () => {
  it("reads the API's citations line by line: findings, a finding with no source, and outdated notes", () => {
    const p = parseResearch(researchAnswer().content as unknown as Anthropic.ContentBlock[]);
    expect(p.findings.map((f) => [f.text, f.citations.map((c) => c.url)])).toEqual([
      ["Reply to new leads within five minutes", ["https://example.org/speed"]],
      ["A same-hour reply works for most service businesses", ["https://example.com/desk"]],
      ["Speed matters most in the first hour", []],
    ]);
    expect(p.outdated).toEqual([{ item: "Bought lead lists", replacedBy: "instant routing of inbound forms", note: "bulk lists are rarely used now",
      sources: [{ url: "https://example.net/old", title: "Lead generation trends" }] }]);
    expect(p.pages.get("https://example.org/speed")).toEqual({ title: "Speed to lead study", pageAge: "March 2026" });
  });

  it("adds what it finds as PROPOSED sources (short quotes only) and claims, logs the call with its searches, and is audited", async () => {
    const r = await research();
    expect(r).toMatchObject({ status: 201, body: { sources: 2, newSources: 2, claims: 3, uncited: 1, outdated: 1, searches: 3 } });
    expect(db.data.sources.map((s) => [s.url, s.status, s.license_class, s.page_age])).toEqual([
      ["https://example.org/speed", "proposed", "web_summarize_only", "March 2026"],
      ["https://example.com/desk", "proposed", "web_summarize_only", "January 2026"],
    ]);
    // Only the cited words are stored for search, never the page.
    expect(db.data.source_chunks.map((c) => c.content)).toEqual(["Respond to new leads within five minutes.", "a same-hour reply converts as well as a five-minute reply"]);
    expect(db.data.source_claims.map((c) => [c.citation_status, c.state, c.extracted_by, c.cited_text ?? null])).toEqual([
      ["cited", "proposed", "ai", "Respond to new leads within five minutes."],
      ["cited", "proposed", "ai", "a same-hour reply converts as well as a five-minute reply"],
      ["no_source", "proposed", "ai", null],
    ]);
    expect(db.data.research_runs[0]).toMatchObject({ topic: "Lead response time", audience_level: "beginner", search_count: 3, source_count: 2, claim_count: 3 });
    // Haiku with the basic web search tool, capped at 5 searches; the prompt holds the topic and nothing else.
    const req = ai.requests[0].params;
    expect(req).toMatchObject({ model: "claude-haiku-4-5", tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }], system: RESEARCH_SYSTEM });
    expect((req.messages as { content: string }[])[0].content).toBe("Topic: Lead response time\nAudience level: beginner\nFreshness question: What tools, terms and methods are current, and what has become outdated?");
    expect(RESEARCH_SYSTEM).toMatch(/## Outdated/);
    expect(db.data.ai_calls[0]).toMatchObject({ purpose: "sources.research", status: "ok", web_search_requests: 3, cost_usd: 0.0165 + 0.03 });
    expect(JSON.stringify(db.data.ai_calls)).not.toMatch(/lead/i);
    expect(db.data.audit_events.at(-1)).toMatchObject({ action: "sources.research", result: "completed" });
  });

  it("reuses a source already in the library without changing its status", async () => {
    await research();
    db.data.sources[0].status = "approved";
    const again = await research();
    expect(again.body).toMatchObject({ sources: 2, newSources: 0 });
    expect(db.data.sources).toHaveLength(2);
    expect(db.data.sources[0].status).toBe("approved");
  });

  it("is off without ANTHROPIC_API_KEY, with a plain message; nothing is recorded but the refusal", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await research();
    expect(r).toMatchObject({ status: 503, body: { reason: expect.stringMatching(/AI features are off: ANTHROPIC_API_KEY isn't set/) } });
    expect(db.data.research_runs ?? []).toHaveLength(0);
    expect((await call(estimateRoute, "GET", "/api/v1/courses/estimate?lessons=10", "owner")).body).toMatchObject({ aiOn: false });
  });

  it("refuses a run whose estimate would pass the spend cap, saying how much is left", async () => {
    vi.stubEnv("AI_DAILY_CAP_USD", "0.05");
    const r = await research();
    expect(r.status).toBe(429);
    expect(r.body.reason).toMatch(/estimated at up to \$0\.11, and only \$0\.05 is left under today's cap of \$0\.05\. Nothing was run/);
    expect(ai.requests).toHaveLength(0);
    expect(db.data.ai_calls).toMatchObject([{ purpose: "sources.research", status: "refused_cap" }]);
  });

  it("never sends a secret or personal details in a prompt", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_supersecretvalue123");
    expect((await research("owner", { topic: "billing sk_test_supersecretvalue123 setup", audience: "beginner" })).body.reason).toMatch(/would contain a secret/);
    expect((await research("owner", { topic: "help for jane.doe@example.com", audience: "beginner" })).body.reason).toMatch(/Remove the email address/);
    expect(ai.requests).toHaveLength(0);
  });

  it("is open to the Owner and admins who build or review courses, never to learners or Support", async () => {
    expect((await research("learner")).status).toBe(403);
    expect((await research("support")).status).toBe(403);
    expect((await research("courseAdmin")).status).toBe(201);
  });
});

describe("the estimate shown before a run", () => {
  it("prices each step from the token budgets and the per-search fee", () => {
    expect(estimateUsd("research")).toBe(0.11);
    expect(estimateUsd("blueprint")).toBe(0.15);
    expect(estimateUsd("lesson")).toBe(0.14);
    expect(courseEstimate(10)).toEqual({ research: 0.11, blueprint: 0.15, perLesson: 0.14, lessons: 10, total: 1.66 });
  });

  it("comes with the caps and what is left", async () => {
    const r = await call(estimateRoute, "GET", "/api/v1/courses/estimate?lessons=4", "reviewer");
    expect(r.body).toMatchObject({ aiOn: true, course: { lessons: 4, total: 0.82 }, caps: { perDay: 5, perMonth: 50 }, left: { day: 5, month: 50 } });
  });
});

describe("the Blueprint", () => {
  const passages = [
    { n: 1, sourceId: "s1", claimId: "c1", quote: "Respond within five minutes.", text: "Reply fast" },
    { n: 2, sourceId: "s2", claimId: null, quote: "Same hour works.", text: "Same hour" },
  ];
  it("turns passage numbers into citations, marks a claim with none, drops attorney talk, keys skills uniquely", () => {
    const plan = toPlan({
      title: "Lead response", outcome: "Answer leads fast",
      modules: [{ title: "Speed", stage: "Foundations", skills: [{ name: "Response time" }, { name: "Response time" }], lessons: [{
        title: "Why minutes matter", minutes: 12, objectives: ["Explain the drop-off"],
        keyClaims: [{ claim: "Reply within five minutes.", passages: [9, 1] }, { claim: "Most leads go cold in a day.", passages: [] }, { claim: "This is attorney-approved.", passages: [2] }],
      }] }],
    }, passages);
    expect(plan.modules[0].lessons[0].keyClaims).toEqual([
      { claim: "Reply within five minutes.", sourceId: "s1", claimId: "c1", quote: "Respond within five minutes." },
      { claim: "Most leads go cold in a day.", sourceId: null },
    ]);
    expect(plan.modules[0].skills).toEqual([{ key: "response-time", name: "Response time" }, { key: "response-time-2", name: "Response time" }]);
  });

  it("is refused before any AI call when a source isn't approved, or the course isn't assigned", async () => {
    await research();
    const ids = db.data.sources.map((s) => s.id);
    const body = { title: "Lead response", topic: "Lead response time", audience: "beginner", sourceIds: ids };
    expect((await call(blueprintsRoute, "POST", "/api/v1/courses/mkt/blueprints", "owner", body, { slug: "mkt" })).status).toBe(409);
    const other = await call(blueprintsRoute, "POST", "/api/v1/courses/sales/blueprints", "courseAdmin", body, { slug: "sales" });
    expect(other).toMatchObject({ status: 403, body: { reason: "You can only work on courses assigned to you." } });
    expect((await call(blueprintsRoute, "POST", "/api/v1/courses/gsa/blueprints", "owner", body, { slug: "gsa" })).status).toBe(403);
    expect(ai.requests.filter((r) => r.kind === "parse")).toHaveLength(0);
  });
});

describe("lesson drafts", () => {
  const sources = [
    { id: "s1", title: "Study", url: "https://example.org/s", license: "open", lastChecked: "2026-09-01", pageAge: null, researchRunId: null },
    { id: "s2", title: "Guide", url: null, license: "web_summarize_only", lastChecked: "2026-03-15", pageAge: null, researchRunId: null },
  ];
  const long = "Leads that are contacted within the first five minutes after they submit a form are many times more likely to become customers than leads contacted after half an hour";
  const passages = [
    { n: 1, sourceId: "s2", claimId: null, quote: "q", text: "A same-hour reply converts well." },
    { n: 2, sourceId: "s1", claimId: null, quote: "q", text: long },
  ];
  it("numbers citations by first use, marks paragraphs with no source, removes copied ones, and dates the lesson by its oldest source", () => {
    const out = toLessonBody({
      summary: "Why speed matters.",
      sections: [{ heading: "Speed", paragraphs: [
        { text: "Replying within the hour is usually enough.", passages: [1] },
        { text: "Fast replies win, especially in the first minutes.", passages: [2, 1, 7] },
        { text: "Most teams can manage this with simple routing.", passages: [] },
        { text: long, passages: [2] },
      ] }],
      takeaways: [{ text: "Answer within the hour.", passages: [1] }],
    }, passages, sources);
    expect(out.citations.map((c) => [c.ref, c.sourceId])).toEqual([[1, "s2"], [2, "s1"]]);
    expect(out.body.sections[0].paragraphs).toEqual([
      { text: "Replying within the hour is usually enough.", refs: [1] },
      { text: "Fast replies win, especially in the first minutes.", refs: [1, 2] },
      { text: "Most teams can manage this with simple routing.", refs: [] },
    ]);
    expect(out.uncited).toBe(1);
    expect(out.removed).toEqual([{ text: long.slice(0, 160), copiedWords: long.split(" ").length }]);
    expect(out.removed[0].copiedWords).toBeGreaterThan(MAX_COPIED_WORDS);
    expect(out.lastVerifiedOn).toBe("2026-03-15");
  });

  it("measures copying as the longest run of shared words", () => {
    expect(longestSharedRun("Reply to leads, fast and well!", "you should reply to leads fast")).toBe(4);
  });

  it("diffs a new version against the previous one, line by line", () => {
    expect(diffLines(["## A", "one", "two"], ["## A", "one", "three"])).toEqual([
      { op: "same", text: "## A" }, { op: "same", text: "one" }, { op: "remove", text: "two" }, { op: "add", text: "three" },
    ]);
  });

  it("sends the shared course context as a cached block, on Sonnet 5.5 at medium effort, and logs no content", async () => {
    ai.parse = async () => ({ parsed_output: { ok: true }, stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } });
    await structured("lessons.draft", { system: "Write a lesson.", cachedContext: "Approved sources: …", user: "Write the lesson \"Speed\".", schema: z.object({ ok: z.boolean() }) });
    const p = ai.requests[0].params;
    expect(p).toMatchObject({
      model: "claude-sonnet-5-5",
      system: [{ type: "text", text: "Write a lesson." }, { type: "text", text: "Approved sources: …", cache_control: { type: "ephemeral" } }],
      output_config: { effort: "medium" },
    });
    expect(db.data.ai_calls[0]).toMatchObject({ purpose: "lessons.draft", cache_read_tokens: 5000, cost_usd: 0.0006 + 0.001 + 0.001 });
    expect(JSON.stringify(db.data.ai_calls)).not.toMatch(/Speed|Approved sources/);
  });
});
