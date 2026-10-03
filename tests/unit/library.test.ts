/**
 * L1 through the real routes (database faked in memory, Clerk mocked, the Anthropic SDK and Voyage's HTTP API
 * stubbed, web pages stubbed): intake by link, upload and open-license list; approval rules; retrieval with
 * citations; claim extraction that keeps its citations; conflicts and authority decisions; the AI service's
 * off switch, spend cap, call log (no content) and health check. Every action is audited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l1", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
const ai = vi.hoisted(() => ({
  parse: null as unknown as (p: Record<string, unknown>) => Promise<unknown>,
  retrieve: null as unknown as (id: string) => Promise<unknown>,
  requests: [] as Record<string, unknown>[],
}));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    messages = { parse: (p: Record<string, unknown>) => { ai.requests.push(p); return ai.parse(p); } };
    models = { retrieve: (id: string) => ai.retrieve(id) };
  }
  return { default: Anthropic, APIError, AuthenticationError, PermissionDeniedError };
});

import * as sourcesRoute from "@/app/api/v1/sources/route";
import * as uploadRoute from "@/app/api/v1/sources/upload/route";
import * as approveRoute from "@/app/api/v1/sources/[id]/approve/route";
import * as rejectRoute from "@/app/api/v1/sources/[id]/reject/route";
import * as extractRoute from "@/app/api/v1/sources/[id]/claims/route";
import * as searchRoute from "@/app/api/v1/sources/search/route";
import * as claimsRoute from "@/app/api/v1/sources/claims/route";
import * as conflictsRoute from "@/app/api/v1/sources/conflicts/route";
import * as decideRoute from "@/app/api/v1/sources/conflicts/[id]/decide/route";
import * as openListRoute from "@/app/api/v1/sources/open-list/route";
import * as aiRoute from "@/app/api/v1/ai/route";
import * as aiHealthRoute from "@/app/api/v1/ai/health/route";

type Db = ReturnType<typeof seedFake>;
let db: Db;
let pages: Record<string, { type: string; body: string }>;
let voyageCalls: number;

const PAGE_A = `<html><head><title>Speed to lead study</title></head><body><nav>Menu</nav>
  <p>Respond to new leads within five minutes. Leads contacted within five minutes are far more likely to convert than leads contacted later.</p>
  <p>Follow up three times during the first week.</p></body></html>`;
const PAGE_B = `<html><head><title>Service desk guide</title></head><body>
  <p>Respond to new leads within one hour; a same-hour reply converts as well as a five-minute reply for most service businesses.</p></body></html>`;

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  db = seedFake();
  db.data.sources = [];
  fake.db = db;
  session.userId = clerkIdOf("owner");
  pages = {
    "https://example.org/speed": { type: "text/html; charset=utf-8", body: PAGE_A },
    "https://example.com/desk": { type: "text/html", body: PAGE_B },
  };
  voyageCalls = 0;
  ai.requests = [];
  ai.retrieve = async (id) => ({ id, type: "model" });
  ai.parse = async (p) => {
    const system = String(p.system);
    if (system.includes("extract factual claims")) {
      const passage = String((p.messages as { content: string }[])[0].content);
      const claims = passage.includes("five minutes are far")
        ? [{ claim: "Responding to leads within five minutes converts best.", quote: "Respond to new leads within five minutes." },
          { claim: "An invented claim.", quote: "This sentence is not in the passage at all." }]
        : passage.includes("one hour")
          ? [{ claim: "Responding to leads within one hour is enough.", quote: "Respond to new leads within one hour" }]
          : [];
      return { parsed_output: { claims }, stop_reason: "end_turn", usage: { input_tokens: 400, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    }
    const pairs = String((p.messages as { content: string }[])[0].content).match(/Pair (\d+):/g) ?? [];
    return {
      parsed_output: { results: pairs.map((_, i) => ({ pair: i, contradicts: true, reason: "One says five minutes, the other one hour." })) },
      stop_reason: "end_turn", usage: { input_tokens: 200, output_tokens: 40 },
    };
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.voyageai.com/v1/embeddings") {
      voyageCalls++;
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({ data: body.input.map((_, i) => ({ index: i, embedding: Array(1024).fill(0.01) })), usage: { total_tokens: 50 } }), { status: 200 });
    }
    if (url === "https://example.org/moved") return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
    const page = pages[url];
    if (!page) return new Response("not found", { status: 404 });
    const res = new Response(page.body, { status: 200, headers: { "content-type": page.type } });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const isForm = body instanceof FormData;
  const req = new Request(`https://ascentra.test${url}`, {
    method, headers: { ...(isForm ? {} : { "content-type": "application/json" }), cookie: deviceCookie(ROLE_ID[role]) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);
const add = (role: RoleKey, body: Record<string, unknown>) => call(sourcesRoute, "POST", "/api/v1/sources", role, body);
const approve = (id: string, role: RoleKey = "reviewer", reason = "Checked the methodology") =>
  call(approveRoute, "POST", `/api/v1/sources/${id}/approve`, role, reason ? { reason } : {}, { id });
async function twoApprovedSources() {
  const a = (await add("reviewer", { url: "https://example.org/speed", licenseClass: "open", licenseName: "CC BY 4.0" })).body.id as string;
  const b = (await add("reviewer", { url: "https://example.com/desk", licenseClass: "web_summarize_only" })).body.id as string;
  await approve(a);
  await approve(b);
  return { a, b };
}

describe("intake", () => {
  it("adds a link as proposed, with chunks for search; the add is audited", async () => {
    const r = await add("reviewer", { url: "https://example.org/speed", licenseClass: "open", licenseName: "CC BY 4.0" });
    expect(r.status).toBe(201);
    const src = db.data.sources[0];
    expect(src).toMatchObject({ title: "Speed to lead study", kind: "url", license_class: "open", status: "proposed", added_by_account_id: ROLE_ID.reviewer, chunk_count: 1 });
    expect(src.found_at).toEqual(expect.any(String));
    expect(db.data.source_chunks[0].content).toMatch(/^Respond to new leads within five minutes\./);
    expect(db.data.source_chunks[0].content).not.toMatch(/Menu/);
    expect(audit("sources.library.add")).toEqual([expect.objectContaining({ result: "completed", previous_value: "none", new_value: "proposed (open license)" })]);
    expect((await add("reviewer", { url: "https://example.org/speed", licenseClass: "open" })).status).toBe(409);
  });

  it("keeps only a short quote per chunk for a web_summarize_only source", async () => {
    pages["https://example.net/long"] = { type: "text/html", body: `<p>${"A long sentence about follow-up timing for leads. ".repeat(60)}</p>` };
    await add("reviewer", { url: "https://example.net/long", licenseClass: "web_summarize_only" });
    const chunks = db.data.source_chunks;
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect({ excerpt: c.is_excerpt, short: String(c.content).length <= 300 }).toEqual({ excerpt: true, short: true });
  });

  it("refuses links that aren't public https, and pages it can't read", async () => {
    for (const url of ["http://example.org/speed", "https://localhost/x", "https://10.0.0.5/x", "https://192.168.1.1/", "https://user:pw@example.org/", "nonsense"]) {
      expect((await add("reviewer", { url, licenseClass: "open" })).status, url).toBe(400);
    }
    expect((await add("reviewer", { url: "https://example.org/missing", licenseClass: "open" })).status).toBe(422);
    // A redirect to a private address is refused before it's requested.
    expect((await add("reviewer", { url: "https://example.org/moved", licenseClass: "open" })).body.reason).toMatch(/isn't a public website/);
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([u]) => String(u).includes("169.254"))).toBe(false);
    expect((await add("reviewer", { url: "https://example.org/speed", licenseClass: "owner_supplied" })).status).toBe(400);
    expect(db.data.sources).toHaveLength(0);
  });

  it("uploads a document, stored privately, as proposed", async () => {
    const form = new FormData();
    form.set("file", new File([`Owner playbook.\n\nAlways confirm the appointment by text the day before. ${"Detail. ".repeat(20)}`], "playbook.txt", { type: "text/plain" }));
    form.set("licenseClass", "owner_supplied");
    form.set("title", "Owner playbook");
    const r = await call(uploadRoute, "POST", "/api/v1/sources/upload", "owner", form);
    expect(r.status).toBe(201);
    expect(db.data.sources[0]).toMatchObject({ kind: "document", license_class: "owner_supplied", status: "proposed", mime_type: "text/plain", storage_path: expect.stringMatching(/playbook\.txt$/) });
    expect(db.uploads).toEqual([expect.objectContaining({ contentType: "text/plain" })]);
    const big = new FormData();
    big.set("file", new File([new Uint8Array(5 * 1024 * 1024)], "big.pdf", { type: "application/pdf" }));
    big.set("licenseClass", "owner_supplied");
    expect((await call(uploadRoute, "POST", "/api/v1/sources/upload", "owner", big)).status).toBe(413);
  });

  it("adds from the Owner's open-license list (only the Owner edits the list)", async () => {
    expect((await call(openListRoute, "POST", "/api/v1/sources/open-list", "reviewer", { title: "X", url: "https://example.org/speed", licenseName: "CC BY 4.0", reason: "Useful source" })).status).toBe(403);
    const item = await call(openListRoute, "POST", "/api/v1/sources/open-list", "owner", { title: "Speed to lead (open)", url: "https://example.org/speed", licenseName: "CC BY 4.0", reason: "Well-known study" });
    expect(item.status).toBe(201);
    const r = await add("reviewer", { openListId: item.body.id });
    expect(r.status).toBe(201);
    expect(db.data.sources[0]).toMatchObject({ kind: "open_list", license_class: "open", license_name: "CC BY 4.0", title: "Speed to lead (open)" });
  });
});

describe("approval", () => {
  it("needs a reason; an owner-supplied source needs the Owner; learners and admins without the role can't", async () => {
    const id = (await add("reviewer", { url: "https://example.org/speed", licenseClass: "open" })).body.id;
    expect((await approve(id, "reviewer", "")).status).toBe(400);
    expect((await approve(id, "learner")).status).toBe(403);
    expect((await approve(id, "support")).status).toBe(403);
    expect((await approve(id, "reviewer")).status).toBe(200);
    expect(db.data.sources[0]).toMatchObject({ status: "approved", approved_by_account_id: ROLE_ID.reviewer, approved_at: expect.any(String) });
    expect(audit("sources.library.approve").at(-1)).toMatchObject({
      result: "completed", reason: "Checked the methodology", previous_value: expect.stringMatching(/proposed/), new_value: expect.stringMatching(/approved/),
    });
    const form = new FormData();
    form.set("file", new File([`Owner notes about scheduling. ${"More text. ".repeat(10)}`], "notes.md"));
    form.set("licenseClass", "owner_supplied");
    const owned = (await call(uploadRoute, "POST", "/api/v1/sources/upload", "owner", form)).body.id;
    expect((await approve(owned, "reviewer")).body.reason).toMatch(/approved by the Owner/);
    expect((await approve(owned, "owner")).status).toBe(200);
    expect((await call(rejectRoute, "POST", `/api/v1/sources/${owned}/reject`, "reviewer", { reason: "Out of date now" }, { id: owned })).status).toBe(200);
  });

  it("lists with filters by license, status and age; an old approval turns stale", async () => {
    const { a } = await twoApprovedSources();
    db.data.sources.find((s) => s.id === a)!.last_checked_at = "2020-01-01T00:00:00.000Z";
    const all = (await call(sourcesRoute, "GET", "/api/v1/sources", "courseAdmin")).body.sources;
    expect(all.find((s: { id: string }) => s.id === a).status).toBe("stale");
    expect((await call(sourcesRoute, "GET", "/api/v1/sources?license=web_summarize_only", "reviewer")).body.sources).toHaveLength(1);
    expect((await call(sourcesRoute, "GET", "/api/v1/sources?status=approved", "reviewer")).body.sources).toHaveLength(1);
    expect((await call(sourcesRoute, "GET", "/api/v1/sources", "learner")).status).toBe(403);
  });
});

describe("retrieval", () => {
  it("returns approved passages only, each with its source and license; embeddings when Voyage is set", async () => {
    await add("reviewer", { url: "https://example.org/speed", licenseClass: "open", licenseName: "CC BY 4.0" });
    expect((await call(searchRoute, "GET", "/api/v1/sources/search?q=respond%20leads", "courseAdmin")).body.results).toEqual([]);
    await approve(db.data.sources[0].id as string);
    const r = await call(searchRoute, "GET", "/api/v1/sources/search?q=respond%20leads", "courseAdmin");
    expect(r.body).toMatchObject({ mode: "full_text", results: [{ citation: { title: "Speed to lead study", license: "open", licenseName: "CC BY 4.0", url: "https://example.org/speed" } }] });
    vi.stubEnv("VOYAGE_API_KEY", "pa-test");
    expect((await call(searchRoute, "GET", "/api/v1/sources/search?q=respond", "reviewer")).body.mode).toBe("embedding");
    expect(voyageCalls).toBe(1);
    expect((await call(searchRoute, "GET", "/api/v1/sources/search?q=respond", "learner")).status).toBe(403);
  });
});

describe("claims, conflicts and authority decisions", () => {
  it("extracts cited claims (dropping any whose quote isn't in the passage), opens a conflict, and the Reviewer decides", async () => {
    const { a, b } = await twoApprovedSources();
    const first = await call(extractRoute, "POST", `/api/v1/sources/${a}/claims`, "reviewer", {}, { id: a });
    expect(first.body).toMatchObject({ claims: 1, dropped: 1, conflicts: 0 });
    const second = await call(extractRoute, "POST", `/api/v1/sources/${b}/claims`, "reviewer", {}, { id: b });
    expect(second.body).toMatchObject({ claims: 1, conflicts: 1 });
    expect(db.data.source_claims.every((c) => c.citation_status === "cited" && c.chunk_id && c.cited_text && c.extracted_by === "ai")).toBe(true);
    // Haiku for both jobs; the prompt is cached; nothing of the passage is logged.
    expect(ai.requests.every((r) => r.model === "claude-haiku-4-5" && (r.cache_control as { type: string }).type === "ephemeral")).toBe(true);
    expect(db.data.ai_calls.map((c) => c.purpose)).toEqual(["claims.extract", "claims.extract", "conflicts.detect"]);
    expect(JSON.stringify(db.data.ai_calls)).not.toMatch(/five minutes|one hour|leads/);
    expect(db.data.ai_calls[0]).toMatchObject({ status: "ok", input_tokens: 400, output_tokens: 60, cost_usd: 0.0007 });

    const queue = (await call(conflictsRoute, "GET", "/api/v1/sources/conflicts?status=open", "reviewer")).body.conflicts;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ detectedBy: "ai", a: { source: { title: "Service desk guide" } }, b: { source: { title: "Speed to lead study" } } });
    const conflictId = queue[0].id;
    const followed = queue[0].b.id;
    const decide = (body: Record<string, unknown>, role: RoleKey = "reviewer") => call(decideRoute, "POST", `/api/v1/sources/conflicts/${conflictId}/decide`, role, body, { id: conflictId });
    expect((await decide({ chosenClaimId: followed, decision: "Follow the study" })).status).toBe(400);
    expect((await decide({ chosenClaimId: followed, decision: "Follow the study", reason: "It is the primary study" }, "courseAdmin")).status).toBe(403);
    expect((await decide({ chosenClaimId: db.data.source_claims[0].id === followed ? queue[0].a.id + "x" : "nope", decision: "Follow", reason: "Some reason here" })).status).toBe(400);
    expect((await decide({ chosenClaimId: followed, decision: "This is attorney-approved", reason: "Some reason here" })).status).toBe(400);
    const d = await decide({ chosenClaimId: followed, decision: "Follow the five-minute study", reason: "Primary research with a larger sample" });
    expect(d).toMatchObject({ status: 201, body: { version: 1 } });
    expect(db.data.authority_decisions[0]).toMatchObject({ chosen_claim_id: followed, rationale: "Primary research with a larger sample", decided_by_account_id: ROLE_ID.reviewer, version: 1 });
    expect(db.data.source_conflicts[0].status).toBe("resolved");
    expect(audit("sources.conflicts.decide").at(-1)).toMatchObject({ result: "completed", reason: "Primary research with a larger sample", previous_value: "open", new_value: expect.stringMatching(/follow "Speed to lead study"/) });
    expect((await decide({ chosenClaimId: followed, decision: "Still follow the study", reason: "Re-checked after an update" })).body.version).toBe(2);
  });

  it("adds a claim by hand: cited (approved source + quote) or marked as having no source; opens a conflict by hand", async () => {
    const { a, b } = await twoApprovedSources();
    const none = await call(claimsRoute, "POST", "/api/v1/sources/claims", "reviewer", { claim: "Most leads go cold in a day." });
    expect(none).toMatchObject({ status: 201, body: { citation: "no_source" } });
    expect((await call(claimsRoute, "POST", "/api/v1/sources/claims", "reviewer", { claim: "Reply fast.", sourceId: a })).status).toBe(400);
    const ca = (await call(claimsRoute, "POST", "/api/v1/sources/claims", "reviewer", { claim: "Reply within five minutes.", sourceId: a, citedText: "Respond to new leads within five minutes." })).body.id;
    const cb = (await call(claimsRoute, "POST", "/api/v1/sources/claims", "reviewer", { claim: "Reply within one hour.", sourceId: b, citedText: "Respond to new leads within one hour" })).body.id;
    expect((await call(conflictsRoute, "POST", "/api/v1/sources/conflicts", "reviewer", { claimAId: ca, claimBId: none.body.id, why: "Different timings" })).status).toBe(400);
    const c = await call(conflictsRoute, "POST", "/api/v1/sources/conflicts", "reviewer", { claimAId: ca, claimBId: cb, why: "Five minutes vs one hour" });
    expect(c.status).toBe(201);
    expect((await call(conflictsRoute, "POST", "/api/v1/sources/conflicts", "reviewer", { claimAId: cb, claimBId: ca, why: "Five minutes vs one hour" })).status).toBe(409);
    expect((await call(claimsRoute, "POST", "/api/v1/sources/claims", "reviewer", { claim: "This is lawyer-approved." })).status).toBe(400);
  });
});

describe("the AI orchestration service", () => {
  it("is off without ANTHROPIC_API_KEY: AI features say so, the rest works", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { a } = await twoApprovedSources();
    const r = await call(extractRoute, "POST", `/api/v1/sources/${a}/claims`, "reviewer", {}, { id: a });
    expect(r).toMatchObject({ status: 503, body: { reason: expect.stringMatching(/ANTHROPIC_API_KEY isn't set/) } });
    expect(db.data.ai_calls).toEqual([expect.objectContaining({ status: "refused_off" })]);
    expect((await call(searchRoute, "GET", "/api/v1/sources/search?q=respond", "reviewer")).status).toBe(200);
    const status = await call(aiRoute, "GET", "/api/v1/ai", "owner");
    expect(status.body).toMatchObject({ configured: false, models: { "claims.extract": "claude-haiku-4-5" } });
  });

  it("refuses once the spend cap is reached, and logs it", async () => {
    vi.stubEnv("AI_DAILY_CAP_USD", "0.0001");
    db.data.ai_calls = [{ purpose: "claims.extract", provider: "anthropic", model: "claude-haiku-4-5", status: "ok", cost_usd: 0.01, created_at: new Date().toISOString() }];
    const { a } = await twoApprovedSources();
    const r = await call(extractRoute, "POST", `/api/v1/sources/${a}/claims`, "reviewer", {}, { id: a });
    expect(r).toMatchObject({ status: 429, body: { reason: expect.stringMatching(/spend cap is reached/) } });
    expect(db.data.ai_calls.at(-1)).toMatchObject({ status: "refused_cap" });
    expect(ai.requests).toHaveLength(0);
  });

  it("shows Connected only after a real health check succeeds", async () => {
    expect(db.data.connection_statuses ?? []).toEqual([]);
    const ok = await call(aiHealthRoute, "POST", "/api/v1/ai/health", "owner", {});
    expect(ok.body).toMatchObject({ status: "connected", detail: expect.stringMatching(/GET \/v1\/models\/claude-haiku-4-5 succeeded/) });
    expect(db.data.connection_statuses).toEqual([expect.objectContaining({ service: "anthropic", status: "connected", evidence: expect.any(String), checked_at: expect.any(String) })]);
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    ai.retrieve = async () => { throw new (Anthropic as unknown as { AuthenticationError: new (s: number, m: string) => Error }).AuthenticationError(401, "bad key"); };
    const bad = await call(aiHealthRoute, "POST", "/api/v1/ai/health", "owner", {});
    expect(bad.body).toMatchObject({ status: "disconnected", detail: expect.stringMatching(/401/) });
    expect(db.data.connection_statuses[0]).toMatchObject({ status: "disconnected", evidence: null });
    expect((await call(aiHealthRoute, "POST", "/api/v1/ai/health", "reviewer", {})).status).toBe(403);
    expect(audit("ai.status").map((e) => e.result)).toEqual(["completed", "blocked", "blocked"]);
  });
});
