/**
 * L6: the topic catalog and batch generation through the real routes and the real cron handler (database faked in
 * memory, Clerk mocked, the Anthropic SDK replaced): the topics and their states, the whole batch's estimate before
 * anything is queued, the overnight run advancing one course at a time until a person is needed, the spend cap making
 * the rest wait with a reason, and every queue and step audited. Results enter as Draft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai, researchAnswer } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l6c", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as catalogRoute from "@/app/api/v1/catalog/route";
import * as queueRoute from "@/app/api/v1/catalog/queue/route";
import * as cancelRoute from "@/app/api/v1/catalog/jobs/[id]/cancel/route";
import * as cronRoute from "@/app/api/cron/catalog/route";
import { catalogState } from "@/lib/catalog";
import { estimateUsd, topicEstimate } from "@/lib/ai/config";
import { batchQueuedFrom, batchQuoteFrom, catalogFrom } from "@/app/activities-api";

type Db = ReturnType<typeof seedFake>;
let db: Db;
const TOPICS = [
  { slug: "mkt", name: "Client Acquisition Systems", outcome: "Turn more inquiries into booked jobs.", audience_level: "intermediate", origin: "academy_blueprint" },
  { slug: "sales", name: "Sales Systems for Founders", outcome: "Run a repeatable sales process.", audience_level: "intermediate", origin: "academy_blueprint" },
  { slug: "ecom", name: "E-commerce Operations", outcome: "Run inventory and margin reviews.", audience_level: "beginner", origin: "academy_blueprint" },
];

beforeEach(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  db = seedFake();
  fake.db = db;
  db.data.catalog_topics = TOPICS.map((t, i) => ({ id: `t${i}`, ...t }));
  // An existing published course, outside the Academy Blueprint list.
  const a = (await db.client.from("academies").insert({ slug: "lead-basics", name: "Lead basics" }).select("id").single()).data as { id: string };
  const c = (await db.client.from("courses").insert({ academy_id: a.id, version: 1, status: "published" }).select("id").single()).data as { id: string };
  await db.client.from("lesson_versions").insert({ lesson_id: "l1", course_id: c.id, version: 1, status: "published", title: "L", published_at: new Date().toISOString(), verified_at: new Date().toISOString() });
  ai.reset();
  ai.create = async () => researchAnswer();
  ai.parse = async () => ({
    stop_reason: "end_turn", usage: { input_tokens: 9000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    parsed_output: { title: "Client Acquisition Systems", outcome: "Book more jobs.", modules: [{ title: "Speed", stage: "Foundation", skills: [{ name: "Response time" }], lessons: [{ title: "Why minutes matter", minutes: 10, objectives: ["Reply fast"], keyClaims: [{ claim: "Reply within five minutes", passages: [1] }] }] }] },
  });
});

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const catalog = async (role: RoleKey = "owner") => catalogFrom((await call(catalogRoute, "GET", "/api/v1/catalog", role)).body)!;
const queue = (body: Record<string, unknown>, role: RoleKey = "owner") => call(queueRoute, "POST", "/api/v1/catalog/queue", role, body);
async function queued(slugs: string[]) {
  const q = batchQuoteFrom((await queue({ slugs })).body)!;
  return queue({ slugs, confirm: true, expectedTotalUsd: q.totalUsd });
}
const cron = async (auth = `Bearer ${TEST_ENV.CRON_SECRET}`) => {
  const res = await cronRoute.GET(new Request("https://ascentra.test/api/cron/catalog", { headers: { authorization: auth } }));
  return { status: res.status, body: (await res.json()) as { results?: { topic: string; status: string; waitingFor: string | null }[] } };
};
const job = (slug: string) => db.data.catalog_jobs.find((j) => j.topic_slug === slug)!;
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);

describe("the state shown (pure)", () => {
  it.each([
    [null, null, "no_course"],
    [{ status: "queued", waiting_for: null }, null, "researching"],
    [{ status: "waiting", waiting_for: "source_approval" }, null, "waiting_sources"],
    [{ status: "waiting", waiting_for: "blueprint_approval" }, { exists: true, published: false, stale: false, inReview: true, drafting: false }, "in_review"],
    [{ status: "drafting", waiting_for: "spend_cap" }, null, "drafting"],
    [{ status: "done", waiting_for: null }, { exists: true, published: true, stale: false, inReview: false, drafting: false }, "published"],
    [null, { exists: true, published: true, stale: true, inReview: false, drafting: false }, "stale"],
  ] as const)("%j + %j → %s", (j, c, state) => {
    expect(catalogState(j, c)).toBe(state);
  });
});

describe("the catalog", () => {
  it("lists the Academy Blueprint's topics and every course with their states; Reviewers see their assigned ones", async () => {
    const all = await catalog();
    expect(all.topics.map((t) => [t.slug, t.stateLabel, t.canQueue])).toEqual([
      ["mkt", "No course", true], ["ecom", "No course", true], ["sales", "No course", true], ["lead-basics", "Published", false],
    ]);
    expect(all.perTopicUsd).toBe(topicEstimate());
    expect(all.varietyFailures).toEqual([]);
    const reviewer = await catalog("reviewer");
    expect(reviewer.topics.map((t) => [t.slug, t.canQueue])).toEqual([["mkt", false]]);
    expect(reviewer.varietyFailures).toBeNull();
    expect((await call(catalogRoute, "GET", "/api/v1/catalog", "support")).status).toBe(403);
  });
});

describe("queueing a batch", () => {
  it("shows the whole batch's estimate first (nothing queued, nothing recorded), then queues on the same total", async () => {
    const q = batchQuoteFrom((await queue({ slugs: ["mkt", "ecom"] })).body)!;
    expect(q).toMatchObject({ totalUsd: Math.round(topicEstimate() * 2 * 100) / 100, topics: [{ slug: "mkt" }, { slug: "ecom" }], note: expect.stringMatching(/one course at a time/) });
    expect(db.data.catalog_jobs ?? []).toHaveLength(0);
    expect(audit("catalog.queue")).toHaveLength(0);
    expect((await queue({ slugs: ["mkt", "ecom"], confirm: true, expectedTotalUsd: 0.01 })).status).toBe(409);
    const r = await queue({ slugs: ["mkt", "ecom"], confirm: true, expectedTotalUsd: q.totalUsd });
    expect(batchQueuedFrom(r.body)).toMatchObject({ queued: 2, totalUsd: q.totalUsd });
    expect(db.data.catalog_jobs.map((j) => [j.topic_slug, j.status])).toEqual([["mkt", "queued"], ["ecom", "queued"]]);
    expect(audit("catalog.queue").at(-1)).toMatchObject({ result: "completed", previous_value: "not queued", new_value: "2 topic(s) queued" });
    expect((await catalog()).topics.find((t) => t.slug === "mkt")).toMatchObject({ stateLabel: "Researching", canQueue: false });
    expect((await queue({ slugs: ["mkt"] })).body.reason).toMatch(/already queued/);
  });

  it("only the Owner or a Course Admin, on their own topics; never a topic that already has a course", async () => {
    expect((await queue({ slugs: ["mkt"] }, "reviewer")).status).toBe(403);
    // A Course Admin doesn't see (or queue) a topic that isn't assigned to them.
    expect((await queue({ slugs: ["sales"] }, "courseAdmin")).status).toBe(404);
    expect((await queue({ slugs: ["mkt"] }, "courseAdmin")).status).toBe(200);
    expect((await queue({ slugs: ["lead-basics"] })).body.reason).toMatch(/already has a course/);
    expect((await queue({ slugs: ["gsa"] })).status).toBe(404);
  });

  it("can be taken off the queue, audited", async () => {
    await queued(["mkt"]);
    const id = String(job("mkt").id);
    expect((await call(cancelRoute, "POST", `/api/v1/catalog/jobs/${id}/cancel`, "owner", {}, { id })).status).toBe(200);
    expect(job("mkt").status).toBe("canceled");
    expect(audit("catalog.queue").at(-1)).toMatchObject({ previous_value: "queued", new_value: "canceled" });
  });
});

describe("the overnight run", () => {
  it("needs the cron secret", async () => {
    expect((await cron("Bearer wrong")).status).toBe(401);
  });

  it("researches one course at a time and stops at source approval; the spend cap holds the rest and says why", async () => {
    // Room for one research run tonight, not two.
    vi.stubEnv("AI_DAILY_CAP_USD", String(estimateUsd("research") + 0.01));
    await queued(["mkt", "ecom"]);
    const r = await cron();
    expect(r.status).toBe(200);
    expect(job("mkt")).toMatchObject({ status: "waiting", waiting_for: "source_approval", research_run_id: expect.any(String) });
    expect(String(job("mkt").note)).toMatch(/Approve or reject them on the Sources page/);
    expect(job("ecom")).toMatchObject({ status: "queued", waiting_for: "spend_cap" });
    expect(String(job("ecom").note)).toMatch(/today's AI spend cap is reached/);
    expect(db.data.sources.filter((s) => s.research_run_id === job("mkt").research_run_id).every((s) => s.status === "proposed")).toBe(true);
    const steps = audit("catalog.job.step").map((e) => [e.target_id, e.previous_value, e.new_value]);
    expect(steps).toEqual(expect.arrayContaining([[job("mkt").id, "researching", "waiting (source_approval)"], [job("ecom").id, "queued", "queued (spend_cap)"]]));
    expect(audit("sources.research").at(-1)).toMatchObject({ actor_account_id: ROLE_ID.owner, actor_label: expect.stringMatching(/overnight batch/) });
    expect((await catalog()).topics.find((t) => t.slug === "mkt")).toMatchObject({ stateLabel: "Waiting for source approval", job: { waitingLabel: expect.stringMatching(/source approval/) } });
  });

  it("after a person approves the sources, the next run drafts the Blueprint and waits for its approval", async () => {
    await queued(["mkt"]);
    await cron();
    const run = job("mkt").research_run_id;
    for (const s of db.data.sources.filter((x) => x.research_run_id === run)) s.status = "approved";
    db.data.sources.find((x) => x.research_run_id === run)!.status = "rejected";
    await cron();
    expect(job("mkt")).toMatchObject({ status: "waiting", waiting_for: "blueprint_approval", blueprint_id: expect.any(String) });
    expect(db.data.academy_blueprints.find((b) => b.id === job("mkt").blueprint_id)).toMatchObject({ status: "draft", kind: "course", generated_by: "ai" });
    expect((await catalog()).topics.find((t) => t.slug === "mkt")).toMatchObject({ stateLabel: "In review" });
  });

  it("with AI off, queued topics wait and say why; nothing else changes", async () => {
    await queued(["mkt"]);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await cron();
    expect(job("mkt")).toMatchObject({ status: "queued", note: expect.stringMatching(/AI isn't set up/) });
    expect(ai.requests).toHaveLength(0);
  });

  it("stops a job whose queuer can no longer build it", async () => {
    await queued(["mkt"]);
    db.data.accounts.find((a) => a.id === ROLE_ID.owner)!.status = "disabled";
    await cron();
    expect(job("mkt")).toMatchObject({ status: "failed", note: expect.stringMatching(/can no longer build/) });
  });
});
