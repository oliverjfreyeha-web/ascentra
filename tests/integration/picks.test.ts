/**
 * L8 against real Postgres behind PostgREST: pick your path through the real routes and the real SQL functions. A Basic
 * learner answers the five questions, picks 3 skills (a 4th is refused, even sent in parallel), and a business that locks;
 * the Owner changes it with a reason; the audit chain stays intact. Every response a page reads goes through its reader.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as picksRoute from "@/app/api/v1/learn/picks/route";
import * as answersRoute from "@/app/api/v1/learn/picks/answers/route";
import * as topicsRoute from "@/app/api/v1/topics/route";
import * as learnerRoute from "@/app/api/v1/topics/learner/route";
import { adminTopicsFrom, chooserFrom, learnerPicksFrom } from "@/app/picks-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  await q(`insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', 'basic', now() - interval '1 day')`, [ROLE_ID.learner]);
}, 60_000);
afterAll(() => stack?.stop());

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const pick = (slug: string) => call(picksRoute, "POST", "/api/v1/learn/picks", "learner", { slug });

describe("L8 on the real database", () => {
  it("shows the seeded topics and saves the five answers on the profile", async () => {
    const c = chooserFrom((await call(picksRoute, "GET", "/api/v1/learn/picks", "learner")).body)!;
    expect(c.businesses).toHaveLength(24);
    expect(c.skills).toHaveLength(16);
    expect(c.skillCounter).toBe("0 of 3 skills used");
    const r = await call(answersRoute, "PUT", "/api/v1/learn/picks/answers", "learner", { goal: "start", hours: 10, experience: "some", style: "build", camera: "yes" });
    expect(chooserFrom(r.body)!.businesses.filter((b) => b.best)).toHaveLength(5);
    expect((await q("select path_style from public.profiles where account_id = $1", [ROLE_ID.learner])).rows).toEqual([{ path_style: "build" }]);
  });

  it("Basic: parallel picks of 6 skills leave exactly 3; the business locks", async () => {
    const slugs = ["copywriting", "negotiation", "public-speaking", "time-management", "email-marketing", "customer-service"];
    const results = await Promise.all(slugs.map((s) => pick(s)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await q("select count(*)::int as n from public.learner_picks where user_id = $1 and kind = 'skill' and status = 'active'", [ROLE_ID.learner])).rows[0].n).toBe(3);
    expect((await pick("website-design")).status).toBe(201);
    expect(await pick("newsletter")).toMatchObject({ status: 403, body: { reason: "Your business is locked. Only the Owner can change this." } });
  });

  it("the Owner changes the business with a reason; topics admin shows demand; the audit chain verifies", async () => {
    const found = learnerPicksFrom((await call(learnerRoute, "GET", "/api/v1/topics/learner?email=learner@example.com", "owner")).body)!;
    expect(found.found && found.picks.find((p) => p.kind === "business")).toMatchObject({ slug: "website-design", locked: true });
    const r = await call(learnerRoute, "POST", "/api/v1/topics/learner", "owner", { accountId: ROLE_ID.learner, slug: "newsletter", reason: "Learner asked to switch" });
    expect(r.status).toBe(200);
    const c = chooserFrom((await call(picksRoute, "GET", "/api/v1/learn/picks", "learner")).body)!;
    expect(c.business).toMatchObject({ slug: "newsletter", locked: true });
    const admin = adminTopicsFrom((await call(topicsRoute, "GET", "/api/v1/topics", "courseAdmin")).body)!;
    expect(admin.topics.find((t) => t.slug === "website-design")).toMatchObject({ demandAll: 1, activePicks: 0 });
    expect(admin.topics.reduce((n, t) => n + t.demandAll, 0)).toBe(4);
    const e = (await q("select reason, previous_value, new_value from public.audit_events where action = 'picks.override' and result = 'completed'")).rows;
    expect(e).toEqual([{ reason: "Learner asked to switch", previous_value: "Website design and building for businesses (now paused, kept)", new_value: "Newsletter business (locked)" }]);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });
});
