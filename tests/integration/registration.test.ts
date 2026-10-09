/**
 * B2 against real Postgres behind PostgREST: the sign-up step's writes pass the database's own age rules,
 * the date of birth stays out of reach of the Data API's browser roles, and Support's correction goes
 * through the security-definer function.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, signJwt, type Stack } from "./stack";
import { ROLE_ID, OWNER_EMAIL, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { clerkUser } from "../fixtures/clerk-user";
import { isoDate, usToday } from "@/lib/age";

const clerk = vi.hoisted(() => ({ userId: null as string | null, users: {} as Record<string, unknown>, deleted: [] as string[] }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: !!clerk.userId, userId: clerk.userId, sessionId: `sess_${clerk.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({
    invitations: { createInvitation: vi.fn(async () => ({ id: "inv_int_1" })), revokeInvitation: vi.fn(async () => ({})) },
    users: {
      getUser: async (id: string) => ({ raw: clerk.users[id] }),
      deleteUser: async (id: string) => { clerk.deleted.push(id); return {}; },
    },
  })),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as registrationRoute from "@/app/api/registration/route";
import * as guardianRoute from "@/app/api/registration/guardian/route";
import * as dobRoute from "@/app/api/v1/support/accounts/[accountId]/date-of-birth/route";

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

function yearsAgo(years: number, days = 0) {
  const t = usToday();
  const d = new Date(Date.UTC(t.y - years, t.m - 1, t.d + days));
  return isoDate({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}
function as(id: string, email: string) {
  clerk.users[id] = clerkUser({ id, email, passwordEnabled: true, twoFactorEnabled: true });
  clerk.userId = id;
}
const post = async (mod: { POST: (r: Request) => Promise<Response> }, body: unknown) => {
  const res = await mod.POST(new Request("https://ascentra.test/api/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const row = async (clerkId: string) =>
  (await q("select id, role, status, is_minor, to_char(date_of_birth, 'YYYY-MM-DD') as dob from public.accounts where clerk_user_id = $1", [clerkId])).rows[0];
const tokenFor = (clerkId: string) => signJwt({ role: "authenticated", sub: clerkId, exp: Math.floor(Date.now() / 1000) + 600 }, stack.jwtSecret);
const rest = (path: string, key: string, init: RequestInit = {}) =>
  fetch(`${stack.url}/rest/v1/${path}`, { ...init, headers: { "content-type": "application/json", apikey: key, Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });

describe("the sign-up step on the real database", () => {
  it("creates an active adult and a pending teen; the database accepts both", async () => {
    as("user_int_adult", "int.adult@example.com");
    expect((await post(registrationRoute, { dateOfBirth: yearsAgo(30), usResident: true })).body).toEqual({ state: "interview", next: "/learn/choose?onboarding=1" });
    expect(await row("user_int_adult")).toMatchObject({ role: "learner", status: "active", is_minor: false, dob: yearsAgo(30) });

    as("user_int_teen", "int.teen@example.com");
    expect((await post(registrationRoute, { dateOfBirth: yearsAgo(15), usResident: true })).body).toEqual({ state: "guardian", guardianEmail: null, progress: "none", emailSent: false });
    expect(await row("user_int_teen")).toMatchObject({ role: "learner", status: "pending", is_minor: true });
    expect((await post(guardianRoute, { guardianEmail: "int.parent@example.com" })).status).toBe(201);
    const { rows } = await q("select invited_email, verification_status, guardian_account_id, clerk_invitation_id from public.guardian_relationships");
    expect(rows).toEqual([{ invited_email: "int.parent@example.com", verification_status: "invited", guardian_account_id: null, clerk_invitation_id: "inv_int_1" }]);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });

  it("stores nothing for someone under 14", async () => {
    const before = (await q("select count(*)::int as n from public.accounts")).rows[0].n;
    as("user_int_child", "int.child@example.com");
    expect((await post(registrationRoute, { dateOfBirth: yearsAgo(12), usResident: true })).status).toBe(403);
    expect((await q("select count(*)::int as n from public.accounts")).rows[0].n).toBe(before);
    expect(clerk.deleted).toContain("user_int_child");
    const { rows } = await q("select count(*)::int as n from public.audit_events where target_label = $1 or context like $2", ["int.child@example.com", "%int.child%"]);
    expect(rows[0].n).toBe(0);
  });

  it("keeps the date of birth out of reach of the account itself, and refuses its own change", async () => {
    const t = tokenFor("user_int_adult");
    expect((await rest("accounts?select=date_of_birth", t)).status).toBeGreaterThanOrEqual(400);
    expect((await rest("accounts?select=id,role", t)).status).toBe(200);
    const id = (await row("user_int_adult")).id;
    expect((await rest(`accounts?id=eq.${id}`, t, { method: "PATCH", body: JSON.stringify({ date_of_birth: yearsAgo(20) }) })).status).toBeGreaterThanOrEqual(400);
    for (const key of [t, stack.anonKey]) {
      const r = await rest("rpc/support_change_date_of_birth", key, { method: "POST", body: JSON.stringify({ p_account: id, p_dob: yearsAgo(31) }) });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect((await row("user_int_adult")).dob).toBe(yearsAgo(30));
  });

  it("lets Support correct it through the API, with a reason, within the same age group", async () => {
    const id = (await row("user_int_adult")).id;
    clerk.userId = clerkIdOf("support");
    const patch = (body: unknown) => dobRoute.PATCH(
      new Request(`https://ascentra.test/api/v1/support/accounts/${id}/date-of-birth`, {
        method: "PATCH", headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID.support) }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ accountId: id }) });
    expect((await patch({ dateOfBirth: yearsAgo(16), reason: "Learner says they are 16" })).status).toBe(409);
    expect((await patch({ dateOfBirth: yearsAgo(31), reason: "Typo confirmed with the learner" })).status).toBe(200);
    expect((await row("user_int_adult")).dob).toBe(yearsAgo(31));
    const { rows } = await q("select result, reason from public.audit_events where action = 'support.dob.change' order by seq");
    expect(rows).toEqual([
      { result: "blocked", reason: "Learner says they are 16" },
      { result: "completed", reason: "Typo confirmed with the learner" },
    ]);
  });
});
