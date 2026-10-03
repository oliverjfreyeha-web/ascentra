/**
 * L1 against real Postgres (with pgvector) behind PostgREST: the source library's routes pass the database's own
 * rules. Only the outside web page is stubbed; AI and embeddings are off here (no keys), so search is full-text.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_reviewer" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as sourcesRoute from "@/app/api/v1/sources/route";
import * as approveRoute from "@/app/api/v1/sources/[id]/approve/route";
import * as searchRoute from "@/app/api/v1/sources/search/route";
import * as claimsRoute from "@/app/api/v1/sources/claims/route";
import * as conflictsRoute from "@/app/api/v1/sources/conflicts/route";
import * as decideRoute from "@/app/api/v1/sources/conflicts/[id]/decide/route";
import * as aiRoute from "@/app/api/v1/ai/route";

const PAGES: Record<string, string> = {
  "https://example.org/speed": "<html><head><title>Speed to lead study</title></head><body><p>Respond to new leads within five minutes.</p><p>Teams that called back fast booked more appointments.</p></body></html>",
  "https://example.com/desk": "<html><head><title>Service desk guide</title></head><body><p>Respond to new leads within one hour.</p><p>A short delay lets the desk check the request first.</p></body></html>",
};

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("VOYAGE_API_KEY", "");
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const page = PAGES[url];
    return page ? Promise.resolve(new Response(page, { headers: { "content-type": "text/html" } })) : realFetch(input, init);
  });
}, 60_000);
afterAll(() => { vi.unstubAllGlobals(); return stack?.stop(); });

type Mod = Record<string, unknown>;
async function call(mod: Mod, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body ? JSON.stringify(body) : undefined,
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}

describe("L1 on the real database", () => {
  it("adds, approves, searches, cites, records a conflict and an authority decision; the audit chain holds", async () => {
    const add = (url: string, licenseClass: string) => call(sourcesRoute, "POST", "/api/v1/sources", "reviewer", { url, licenseClass });
    const a = await add("https://example.org/speed", "open");
    expect(a, JSON.stringify(a.body)).toMatchObject({ status: 201, body: { chunks: 1, embedded: false } });
    const b = await add("https://example.com/desk", "web_summarize_only");
    expect(b.status).toBe(201);
    expect((await add("https://EXAMPLE.org/speed", "open")).status).toBe(409);

    // Proposed sources aren't searched.
    expect((await call(searchRoute, "GET", "/api/v1/sources/search?q=leads", "courseAdmin")).body.results).toEqual([]);
    for (const [id, role] of [[a.body.id, "reviewer"], [b.body.id, "owner"]] as const) {
      expect((await call(approveRoute, "POST", `/api/v1/sources/${id}/approve`, role, { reason: "Checked the methodology" }, { id })).status).toBe(200);
    }
    const found = await call(searchRoute, "GET", "/api/v1/sources/search?q=respond%20leads", "courseAdmin");
    expect(found.body.mode).toBe("full_text");
    expect(found.body.results.map((r: { citation: { title: string } }) => r.citation.title).sort()).toEqual(["Service desk guide", "Speed to lead study"]);
    expect((await call(sourcesRoute, "GET", "/api/v1/sources?status=approved&license=open", "courseAdmin")).body.sources).toHaveLength(1);

    const claim = (body: Record<string, unknown>) => call(claimsRoute, "POST", "/api/v1/sources/claims", "reviewer", body);
    const ca = await claim({ claim: "Reply within five minutes.", sourceId: a.body.id, citedText: "Respond to new leads within five minutes." });
    const cb = await claim({ claim: "Reply within one hour.", sourceId: b.body.id, citedText: "within one hour" });
    expect([ca.status, cb.status]).toEqual([201, 201]);
    expect((await claim({ claim: "Leads go cold in a day." })).body.citation).toBe("no_source");

    const c = await call(conflictsRoute, "POST", "/api/v1/sources/conflicts", "reviewer", { claimAId: ca.body.id, claimBId: cb.body.id, why: "Five minutes vs one hour" });
    expect(c.status).toBe(201);
    expect((await call(conflictsRoute, "POST", "/api/v1/sources/conflicts", "reviewer", { claimAId: cb.body.id, claimBId: ca.body.id, why: "Again" })).status).toBe(409);
    const id = (await call(conflictsRoute, "GET", "/api/v1/sources/conflicts?status=open", "reviewer")).body.conflicts[0].id;
    const d = await call(decideRoute, "POST", `/api/v1/sources/conflicts/${id}/decide`, "reviewer",
      { chosenClaimId: ca.body.id, decision: "Follow the five-minute study", reason: "Primary research with a larger sample" }, { id });
    expect(d).toMatchObject({ status: 201, body: { version: 1 } });
    expect((await q("select status from public.source_conflicts where id = $1", [id])).rows[0].status).toBe("resolved");
    expect((await q("select rationale from public.authority_decisions where source_conflict_id = $1", [id])).rows[0].rationale).toBe("Primary research with a larger sample");

    const { rows } = await q("select action from public.audit_events where action like 'sources.%' order by seq");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["sources.library.add", "sources.library.approve", "sources.claims.add", "sources.conflicts.open", "sources.conflicts.decide"]));
    expect((await q("select * from public.audit_verify_chain()")).rows[0]).toMatchObject({ ok: true });
  });

  it("with no AI key, AI is off and says so", async () => {
    expect((await call(aiRoute, "GET", "/api/v1/ai", "owner")).body).toMatchObject({ configured: false, embeddings: false });
  });
});
