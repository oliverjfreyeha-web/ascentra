/**
 * Gate 1 (F7): every role × every /api/v1 route handler. Routes, methods and the capability each one
 * asks for are read from the code (tests/support/routes.ts), so a new route is covered automatically.
 *
 * For each request the server must allow exactly what lib/caps.ts grants:
 *   not granted → 403 with the capability's plain reason, one Blocked audit event, nothing else changed;
 *   granted     → never that refusal (the handler may still say 400/404/409 about the request itself).
 *
 * Runs twice: here against the in-memory database, and in tests/integration against real Postgres
 * behind PostgREST (ASCENTRA_REAL_DB=1), where RLS, grants and triggers are the real ones.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_CAPS, ROLES, decide, type Action, type RoleKey } from "@/lib/caps";
import { apiHandlers } from "../support/routes";
import { ROLE_ID, OWNER_EMAIL, clerkIdOf, seedFake, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";

const REAL = !!process.env.ASCENTRA_REAL_DB;
const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.ASCENTRA_REAL_DB ? importOriginal() : { getDb: () => (fake.db as { client: unknown }).client },
);
const session = vi.hoisted(() => ({ userId: "user_owner", sessionId: "sess_gate1" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: session.sessionId, has: () => true })),
  clerkClient: vi.fn(async () => ({
    invitations: { createInvitation: vi.fn(async () => ({ id: "inv_gate1" })), revokeInvitation: vi.fn(async () => ({})) },
    sessions: { revokeSession: vi.fn(async () => ({})) },
  })),
  reverificationErrorResponse: () => Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));

const HANDLERS = apiHandlers();
const REFUSAL = /doesn't have permission to do this|^Only the Owner can do this|^This course isn't assigned|^The Owner Academy is protected/;

type Db = {
  audit: () => Promise<Record<string, unknown>[]>;
  /** A fingerprint of every table except the append-only audit log. */
  fingerprint: () => Promise<string>;
};
let db: Db;
let stop: (() => Promise<void>) | null = null;

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  if (!REAL) return;
  const { startStack } = await import("../integration/stack");
  const stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  const c = stack.db.client;
  const { rows: tables } = await c.query("select tablename from pg_tables where schemaname = 'public' and tablename <> 'audit_events' order by 1");
  db = {
    audit: async () => (await c.query("select * from public.audit_events order by seq")).rows,
    fingerprint: async () => {
      const parts = await Promise.all(tables.map(async ({ tablename }) =>
        `${tablename}:${(await c.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from public.${tablename} t`)).rows[0].h}`));
      return parts.join(",");
    },
  };
  stop = stack.stop;
}, 60_000);
afterAll(async () => {
  await stop?.();
});

beforeEach(() => {
  if (REAL) return;
  const f = seedFake();
  fake.db = f;
  db = {
    audit: async () => f.data.audit_events,
    fingerprint: async () => JSON.stringify(Object.entries(f.data).filter(([t]) => t !== "audit_events")),
  };
});

/**
 * What each route should ask for, written by hand. The code must match it exactly: a new route, or a
 * route that changes the capability it checks, fails here until someone reviews and adds it.
 */
const EXPECTED: Record<string, string> = {
  "GET /api/v1/admins": "admins.view",
  "PATCH /api/v1/admins/[accountId]": "admins.role.change",
  "DELETE /api/v1/admins/[accountId]": "admins.revoke",
  "POST /api/v1/admins/invites": "admins.invite",
  "DELETE /api/v1/admins/invites/[id]": "admins.revoke",
  "GET /api/v1/audit": "audit.view",
  "GET /api/v1/billing": "billing.view",
  "POST /api/v1/billing/checkout": "billing.subscribe",
  "POST /api/v1/billing/portal": "billing.portal",
  "GET /api/v1/billing/alerts": "billing.view",
  "POST /api/v1/billing/cancel": "billing.cancel",
  "GET /api/v1/billing/adjustments": "billing.adjustments.view",
  "POST /api/v1/billing/adjustments/[accountId]/refund": "billing.refund",
  "POST /api/v1/billing/adjustments/[accountId]/credit": "billing.credit",
  "GET /api/v1/privacy": "privacy.view",
  "GET /api/v1/sources": "sources.library.view",
  "POST /api/v1/sources": "sources.library.add",
  "POST /api/v1/sources/upload": "sources.library.add",
  "POST /api/v1/sources/[id]/approve": "sources.library.decide",
  "POST /api/v1/sources/[id]/reject": "sources.library.decide",
  "POST /api/v1/sources/[id]/claims": "sources.claims.manage",
  "GET /api/v1/sources/search": "sources.search",
  "GET /api/v1/sources/claims": "sources.library.view",
  "POST /api/v1/sources/claims": "sources.claims.manage",
  "GET /api/v1/sources/conflicts": "sources.library.view",
  "POST /api/v1/sources/conflicts": "sources.claims.manage",
  "POST /api/v1/sources/conflicts/[id]/decide": "sources.conflicts.decide",
  "GET /api/v1/sources/open-list": "sources.library.view",
  "POST /api/v1/sources/open-list": "sources.open_list.edit",
  "DELETE /api/v1/sources/open-list/[id]": "sources.open_list.edit",
  "GET /api/v1/sources/research": "sources.research",
  "POST /api/v1/sources/research": "sources.research",
  "GET /api/v1/courses": "courses.view",
  "GET /api/v1/courses/estimate": "courses.view",
  "GET /api/v1/courses/[slug]": "courses.view",
  "POST /api/v1/courses/[slug]/blueprints": "courses.build",
  "PATCH /api/v1/courses/[slug]/blueprints/[id]": "courses.build",
  "POST /api/v1/courses/[slug]/blueprints/[id]/approve": "courses.build",
  "POST /api/v1/courses/[slug]/lessons/[id]/draft": "courses.build",
  "POST /api/v1/courses/[slug]/versions/[id]/submit": "courses.build",
  "POST /api/v1/courses/[slug]/versions/[id]/verify": "courses.verify",
  "POST /api/v1/courses/[slug]/versions/[id]/publish": "courses.release",
  "PATCH /api/v1/courses/[slug]/refresh": "courses.refresh.configure",
  "POST /api/v1/courses/[slug]/refresh": "courses.refresh.run",
  "POST /api/v1/courses/[slug]/refresh/edits/[id]": "courses.verify",
  "POST /api/v1/courses/[slug]/refresh/reports/[id]/close": "courses.verify",
  "GET /api/v1/learn/courses": "learn",
  "POST /api/v1/mentor": "learn",
  "GET /api/v1/mentor/threads": "learn",
  "DELETE /api/v1/mentor/threads": "learn",
  "GET /api/v1/mentor/threads/[id]": "learn",
  "DELETE /api/v1/mentor/threads/[id]": "learn",
  "GET /api/v1/safety/events": "safety.view",
  "POST /api/v1/safety/events/[id]/review": "safety.review",
  "GET /api/v1/learn/lessons/[id]": "learn",
  "POST /api/v1/learn/lessons/[id]/progress": "learn",
  "GET /api/v1/ai": "ai.status",
  "POST /api/v1/ai/health": "ai.status",
  "POST /api/v1/privacy/export": "privacy.export",
  "POST /api/v1/privacy/deletion": "privacy.delete.request",
  "POST /api/v1/privacy/consents/[id]/withdraw": "privacy.consent.withdraw",
  "POST /api/v1/audit/export": "audit.export",
  "POST /api/v1/audit/verify": "audit.verify",
  "GET /api/v1/devices": "devices.manage",
  "DELETE /api/v1/devices/[id]": "devices.manage",
  "POST /api/v1/devices/[id]/sign-out": "devices.manage",
  "POST /api/v1/devices/replace": "devices.replace",
  "GET /api/v1/me": "self.view",
  "GET /api/v1/guardian": "guardian.controls",
  "POST /api/v1/guardian/identity": "guardian.identity.verify",
  "POST /api/v1/guardian/teens/[accountId]/consent": "guardian.consent.give",
  "POST /api/v1/guardian/teens/[accountId]/withdraw": "guardian.consent.withdraw",
  "PATCH /api/v1/support/accounts/[accountId]/date-of-birth": "support.dob.change",
  "GET /api/v1/owner-academy": "owner_academy.open",
  "GET /api/v1/pro": "learn",
  "GET /api/v1/security/accounts": "security.inspect",
  "GET /api/v1/security/accounts/[accountId]": "security.inspect",
  "DELETE /api/v1/security/accounts/[accountId]/devices/[deviceId]": "support.device.free",
  "POST /api/v1/security/accounts/[accountId]/limit": "security.limit",
  "POST /api/v1/security/accounts/[accountId]/suspend": "security.suspend",
  "GET /api/v1/security/appeals": "security.inspect",
  "POST /api/v1/security/appeals": "security.appeal.submit",
  "POST /api/v1/security/appeals/[id]": "support.appeal.decide",
  "POST /api/v1/security/notice": "self.view",
  "POST /api/v1/security/verify": "security.verify",
  "POST /api/v1/session": "self.view",
  "POST /api/v1/session/continue": "self.view",
  "POST /api/v1/session/end": "self.view",
};
const keyOf = (h: (typeof HANDLERS)[number]) => `${h.method} /${h.file.replace(/^app\//, "").replace(/\/route\.tsx?$/, "")}`;

describe("the route list comes from the code", () => {
  it("each handler asks for a capability that exists", () => {
    for (const h of HANDLERS) expect(ALL_CAPS, `${h.method} ${h.url}`).toContain(h.action);
  });

  it("matches the reviewed route → capability table exactly (nothing new slips past)", () => {
    expect(Object.fromEntries(HANDLERS.map((h) => [keyOf(h), h.action]))).toEqual(EXPECTED);
  });
});

describe.each(HANDLERS.map((h) => [`${h.method} ${h.url.replace("http://localhost", "")} (${h.action})`, h] as const))("%s", (_name, h) => {
  it.each([...ROLES])("%s", async (role: RoleKey) => {
    session.userId = clerkIdOf(role);
    session.sessionId = `sess_${role}`;
    const mod = (await import(/* @vite-ignore */ h.module)) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
    const url = h.method === "GET" ? `${h.url}?q=nobody@example.com` : h.url;
    const req = new Request(url, {
      method: h.method,
      headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]), "user-agent": "Gate1" },
      body: h.method === "GET" ? undefined : JSON.stringify({ reason: "Gate 1 route check", text: "Gate 1 check of the appeal route, not a real appeal." }),
    });
    const before = await db.fingerprint();
    const auditBefore = (await db.audit()).length;
    const res = await mod[h.method](req, { params: Promise.resolve(h.params) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    const decision = decide({ role, assignedCourses: role === "courseAdmin" || role === "reviewer" ? ["mkt"] : [] }, h.action as Action);

    expect(res.status, JSON.stringify(body)).not.toBe(401);
    if (!decision.allowed) {
      expect(res.status).toBe(403);
      expect(body).toMatchObject({ error: "forbidden", reason: decision.reason });
      const added = (await db.audit()).slice(auditBefore);
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ action: h.action, result: "blocked", status: "No change made", actor_account_id: ROLE_ID[role] });
      expect(added[0].device_id).toEqual(expect.any(String));
      expect(await db.fingerprint()).toBe(before);
    } else {
      expect(body.reason ?? "", `${role} was refused ${h.action}`).not.toMatch(REFUSAL);
      expect(body.error ?? "").not.toBe("device_not_trusted");
    }
  });
});
