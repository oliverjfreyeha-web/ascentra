/**
 * Gate 1 bypass attempts, against real Postgres behind PostgREST (the Supabase Data API's engine):
 *   1. calling the database directly with no key, the anon key, a learner's token, a forged or an
 *      expired token;
 *   2. a forged role in a request body or header;
 *   3. a tampered, wrongly signed or expired session token (Clerk's own verifier, networkless);
 *   4. a replayed, wrong-email or expired invite (the real webhook, real SQL);
 *   5. setting a role to "owner" and demoting the Owner.
 * Every attempt must be refused, and nothing may change.
 */
import { generateKeyPairSync, createSign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { NextRequest } from "next/server";
import { verifyToken } from "@clerk/backend";
import { startStack, signJwt, type Stack } from "./stack";
import { ROLE_ID, OWNER_EMAIL, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { clerkUser } from "../fixtures/clerk-user";
import { EXPECTED_TABLES } from "../db/helpers";

const session = vi.hoisted(() => ({ userId: "user_learner" }));
const clerk = vi.hoisted(() => ({ n: 0 }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({
    invitations: { createInvitation: vi.fn(async () => ({ id: `inv_clerk_${++clerk.n}` })), revokeInvitation: vi.fn(async () => ({})) },
    sessions: { revokeSession: vi.fn(async () => ({})) },
  })),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
}, 60_000);
afterAll(() => stack?.stop());

// ============ 1. The database, called directly ============

const rest = (path: string, key: string | null, init: RequestInit = {}) =>
  fetch(`${stack.url}/rest/v1/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) },
  });
const learnerToken = () =>
  signJwt({ role: "authenticated", sub: clerkIdOf("learner"), exp: Math.floor(Date.now() / 1000) + 600 }, stack.jwtSecret);

describe("calling the database directly", () => {
  it("with no key: refused for every table", async () => {
    for (const t of EXPECTED_TABLES) {
      const r = await rest(`${t}?select=*&limit=1`, null);
      expect(r.status, t).toBeGreaterThanOrEqual(400);
    }
  });

  it("with the anon key: refused for every table, every write and every function", async () => {
    for (const t of EXPECTED_TABLES) {
      expect((await rest(`${t}?select=*&limit=1`, stack.anonKey)).status, `read ${t}`).toBe(401);
      expect((await rest(t, stack.anonKey, { method: "POST", body: "{}" })).status, `insert ${t}`).toBe(401);
    }
    expect((await rest("accounts?id=not.is.null", stack.anonKey, { method: "PATCH", body: JSON.stringify({ role: "owner" }) })).status).toBe(401);
    expect((await rest("audit_events?seq=gt.0", stack.anonKey, { method: "DELETE" })).status).toBe(401);
    for (const fn of ["audit_verify_chain", "claim_device_slot", "pick_topic", "owner_set_business", "reconcile_picks"]) {
      expect((await rest(`rpc/${fn}`, stack.anonKey, { method: "POST", body: "{}" })).status, fn).toBeGreaterThanOrEqual(400);
    }
  });

  it("with a learner's token: their own account and profile only, nothing else, no writes, no functions", async () => {
    const t = learnerToken();
    const acc = await (await rest("accounts?select=id,email,role", t)).json();
    expect(acc).toEqual([{ id: ROLE_ID.learner, email: "learner@example.com", role: "learner" }]);
    const prof = await (await rest("profiles?select=account_id", t)).json();
    expect(prof).toEqual([{ account_id: ROLE_ID.learner }]);
    // L8: published topics and their own picks are readable; nothing else, and neither is writable.
    expect((await (await rest("topics?select=slug&published=eq.false", t)).json())).toEqual([]);
    expect((await (await rest("topics?select=slug", t)).json()).length).toBeGreaterThan(0);
    const picks = (await (await rest("learner_picks?select=user_id", t)).json()) as { user_id: string }[];
    expect(picks.every((p) => p.user_id === ROLE_ID.learner)).toBe(true);
    expect((await rest("learner_picks", t, { method: "POST", body: JSON.stringify({ user_id: ROLE_ID.learner, topic_id: ROLE_ID.learner, kind: "skill" }) })).status).toBeGreaterThanOrEqual(400);
    expect((await rest("topics?slug=eq.copywriting", t, { method: "PATCH", body: JSON.stringify({ published: false }) })).status).toBeGreaterThanOrEqual(400);
    for (const table of EXPECTED_TABLES.filter((x) => !["accounts", "profiles", "topics", "learner_picks"].includes(x))) {
      // PostgREST: 403 "permission denied" for a signed-in role (401 is for anon).
      expect((await rest(`${table}?select=*&limit=1`, t)).status, table).toBe(403);
    }
    expect((await rest("accounts?select=clerk_user_id", t)).status).toBe(403);
    // Promote themselves, rename, delete the log: all refused, nothing changed.
    expect((await rest(`accounts?id=eq.${ROLE_ID.learner}`, t, { method: "PATCH", body: JSON.stringify({ role: "owner" }) })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(`profiles?account_id=eq.${ROLE_ID.learner}`, t, { method: "PATCH", body: JSON.stringify({ display_name: "x" }) })).status).toBeGreaterThanOrEqual(400);
    expect((await rest("audit_events?seq=gt.0", t, { method: "DELETE" })).status).toBeGreaterThanOrEqual(400);
    expect((await rest("role_assignments", t, { method: "POST", body: JSON.stringify({ account_id: ROLE_ID.learner, role: "super_admin", assigned_by_account_id: ROLE_ID.learner }) })).status).toBeGreaterThanOrEqual(400);
    for (const fn of ["audit_verify_chain", "claim_device_slot", "pick_topic", "owner_set_business", "reconcile_picks"]) {
      expect((await rest(`rpc/${fn}`, t, { method: "POST", body: "{}" })).status, fn).toBeGreaterThanOrEqual(400);
    }
    expect((await q("select role from public.accounts where id = $1", [ROLE_ID.learner])).rows[0].role).toBe("learner");
  });

  it("with a forged token (wrong signature, claiming service_role) or an expired one: 401", async () => {
    const forged = signJwt({ role: "service_role" }, "not-the-project-secret-0123456789");
    expect((await rest("accounts?select=*", forged)).status).toBe(401);
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"role":"service_role"}').toString("base64url")}.`;
    expect((await rest("accounts?select=*", unsigned)).status).toBe(401);
    const expired = signJwt({ role: "service_role", exp: Math.floor(Date.now() / 1000) - 60 }, stack.jwtSecret);
    expect((await rest("accounts?select=*", expired)).status).toBe(401);
  });
});

// ============ 2. A forged role in the request ============

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (role: keyof typeof ROLE_ID, mod: Record<string, any>, method: string, body?: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  session.userId = clerkIdOf(role);
  const res = await mod[method](new Request("http://localhost/api/v1/x", {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]), ...headers },
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

describe("a forged role in the request", () => {
  it("is ignored: identity and role come only from the session and the database", async () => {
    const me = await import("@/app/api/v1/me/route");
    const r = await call("learner", me, "GET", undefined, {}, { "x-role": "owner", "x-user-id": clerkIdOf("owner"), cookie: `${deviceCookie(ROLE_ID.learner)}; role=owner` });
    expect(r.body.account).toMatchObject({ id: ROLE_ID.learner, roleKey: "learner" });
  });

  it("in a body cannot grant anything", async () => {
    const invites = await import("@/app/api/v1/admins/invites/route");
    const before = (await q("select count(*)::int as n from public.role_assignments")).rows[0].n;
    for (const role of ["learner", "support", "superAdmin"] as const) {
      const r = await call(role, invites, "POST", { email: "x@example.com", role: "superAdmin", reason: "Forged by the caller", actor: "owner", roleKey: "owner", accountId: ROLE_ID.owner });
      expect(r.status, role).toBe(403);
    }
    expect((await q("select count(*)::int as n from public.role_assignments")).rows[0].n).toBe(before);
  });
});

// ============ 3. A tampered, wrongly signed or expired session ============

describe("the session token (Clerk's verifier, as auth() uses it)", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwtKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const sign = (claims: Record<string, unknown>, key = keys.privateKey) => {
    const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "ins_test" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const s = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url");
    return `${head}.${body}.${s}`;
  };
  const now = () => Math.floor(Date.now() / 1000);
  const good = () => ({ sub: clerkIdOf("learner"), sid: "sess_1", iss: "https://clerk.example.com", iat: now() - 5, nbf: now() - 5, exp: now() + 60 });

  it("accepts a correctly signed, current token (control)", async () => {
    await expect(verifyToken(sign(good()), { jwtKey })).resolves.toMatchObject({ sub: clerkIdOf("learner") });
  });
  it("refuses a token whose payload was changed (user id swapped for the Owner's)", async () => {
    const [h, , s] = sign(good()).split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...good(), sub: clerkIdOf("owner") })).toString("base64url")}.${s}`;
    await expect(verifyToken(tampered, { jwtKey })).rejects.toThrow();
  });
  it("refuses a token signed with another key", async () => {
    await expect(verifyToken(sign(good(), other.privateKey), { jwtKey })).rejects.toThrow();
  });
  it("refuses an expired token", async () => {
    await expect(verifyToken(sign({ ...good(), iat: now() - 600, nbf: now() - 600, exp: now() - 300 }), { jwtKey })).rejects.toThrow(/expired/i);
  });
  it("refuses an unsigned (alg none) token", async () => {
    const t = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(good())).toString("base64url")}.`;
    await expect(verifyToken(t, { jwtKey })).rejects.toThrow();
  });
});

// ============ 4. Invites: replayed, wrong email, expired ============

describe("admin invites through the real webhook", () => {
  const secret = TEST_ENV.CLERK_WEBHOOK_SIGNING_SECRET;
  const hook = async (data: unknown, id = `msg_${Math.random()}`) => {
    const { POST } = await import("@/app/api/webhooks/clerk/route");
    const body = JSON.stringify({ type: "user.created", object: "event", data });
    const at = new Date();
    const sig = new Webhook(secret.replace(/^whsec_/, "")).sign(id, at, body);
    const res = await POST(new NextRequest("http://localhost/api/webhooks/clerk", {
      method: "POST", body, headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(Math.floor(at.getTime() / 1000)), "svix-signature": sig },
    }));
    return (await res.json()) as { outcome: string };
  };
  const user = (id: string, email: string, inviteId: string) => ({ ...clerkUser({ id, email, twoFactorEnabled: true, passwordEnabled: true }), public_metadata: { ascentra_invite_id: inviteId } });
  const invite = async (email: string) => {
    const invites = await import("@/app/api/v1/admins/invites/route");
    const r = await call("owner", invites, "POST", { email, role: "support", reason: "Gate 1 invite check" });
    expect(r.status).toBe(201);
    return (await q("select id from public.role_assignments where invited_email = $1 and status = 'invited'", [email])).rows[0].id as string;
  };
  const accountFor = async (clerkId: string) => (await q("select id, role from public.accounts where clerk_user_id = $1", [clerkId])).rows[0];

  it("refuses an invite claimed by a different email", async () => {
    const id = await invite("right@example.com");
    expect((await hook(user("user_wrong", "wrong@example.com", id))).outcome).toBe("invite_refused");
    expect(await accountFor("user_wrong")).toBeUndefined();
  });

  it("claims once, then refuses the same invite replayed for someone else", async () => {
    const id = await invite("new-support@example.com");
    expect((await hook(user("user_new_support", "new-support@example.com", id))).outcome).not.toBe("invite_refused");
    expect(await accountFor("user_new_support")).toMatchObject({ role: "admin" });
    expect((await hook(user("user_replay", "new-support@example.com", id))).outcome).toBe("invite_refused");
    expect(await accountFor("user_replay")).toBeUndefined();
  });

  it("refuses an expired invite", async () => {
    const id = await invite("late@example.com");
    await q("update public.role_assignments set expires_at = now() - interval '1 minute' where id = $1", [id]);
    expect((await hook(user("user_late", "late@example.com", id))).outcome).toBe("invite_refused");
    expect(await accountFor("user_late")).toBeUndefined();
  });
});

// ============ 5. "owner" as a role, and demoting the Owner ============

describe("the Owner role can't be granted or taken away", () => {
  it("refuses an invite or a role change to \"owner\", by the Owner too", async () => {
    const invites = await import("@/app/api/v1/admins/invites/route");
    const admin = await import("@/app/api/v1/admins/[accountId]/route");
    expect((await call("owner", invites, "POST", { email: "second-owner@example.com", role: "owner", reason: "Trying a second Owner" })).status).toBe(400);
    expect((await call("owner", admin, "PATCH", { role: "owner", reason: "Trying to promote" }, { accountId: ROLE_ID.support })).status).toBe(400);
    expect((await q("select count(*)::int as n from public.accounts where role = 'owner'")).rows[0].n).toBe(1);
  });

  it("refuses demoting or removing the Owner, through the API and in the database itself", async () => {
    const admin = await import("@/app/api/v1/admins/[accountId]/route");
    expect((await call("owner", admin, "PATCH", { role: "support", reason: "Demote the Owner" }, { accountId: ROLE_ID.owner })).status).toBe(403);
    expect((await call("owner", admin, "DELETE", { reason: "Remove the Owner" }, { accountId: ROLE_ID.owner })).status).toBe(403);
    expect((await call("superAdmin", admin, "PATCH", { role: "support", reason: "Demote the Owner" }, { accountId: ROLE_ID.owner })).status).toBe(403);
    // Even the service role can't do it at the database.
    const svc = await rest(`accounts?id=eq.${ROLE_ID.owner}`, stack.serviceKey, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });
    expect(svc.status).toBeGreaterThanOrEqual(400);
    const del = await rest(`accounts?id=eq.${ROLE_ID.owner}`, stack.serviceKey, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) });
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect((await q("select role, status from public.accounts where id = $1", [ROLE_ID.owner])).rows[0]).toEqual({ role: "owner", status: "active" });
  });

  it("the audit chain is intact after every attempt above", async () => {
    const r = (await q("select * from public.audit_verify_chain()")).rows[0];
    expect(r.ok).toBe(true);
    expect(Number(r.checked)).toBeGreaterThan(5);
  });
});
