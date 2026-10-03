/**
 * B3 against real Postgres behind PostgREST: the whole Guardian flow passes the database's own rules (only a verified
 * Guardian authorizes; a teen is active only with a verified Guardian of record; consent rows are insert-only), and
 * withdrawal pauses the teen. Clerk and Stripe are mocked; everything below them is real.
 */
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, seedReal } from "../support/seed";
import { deviceCookie, trustedDeviceRow } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { clerkUser } from "../fixtures/clerk-user";
import { isoDate, usToday } from "@/lib/age";
import { RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";

const clerk = vi.hoisted(() => ({ userId: null as string | null, users: {} as Record<string, unknown>, n: 0 }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: !!clerk.userId, userId: clerk.userId, sessionId: `sess_${clerk.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({
    invitations: { createInvitation: vi.fn(async () => ({ id: `inv_g_${++clerk.n}` })), revokeInvitation: vi.fn(async () => ({})) },
    users: { getUser: async (id: string) => ({ raw: clerk.users[id] }), deleteUser: async () => ({}) },
  })),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
const ENV = {
  STRIPE_SECRET_KEY: "sk_test_b3_int", STRIPE_WEBHOOK_SECRET: "whsec_b3_int", STRIPE_PRICE_BASIC: "price_basic_int",
  STRIPE_PRICE_PRO: "price_pro_int", STRIPE_PORTAL_CONFIG: "bpc_int",
};
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const fx = vi.hoisted(() => ({ subs: {} as Record<string, unknown>, vs: {} as Record<string, { status: string; dob: unknown }>, n: 0 }));
vi.mock("@/lib/billing-env", async (orig) => ({
  ...(await orig<object>()),
  stripeClient: () => ({
    webhooks: real.webhooks,
    prices: { retrieve: async (id: string) => ({ id, active: true, currency: "usd", type: "recurring", unit_amount: 2000, recurring: { interval: "month", interval_count: 1 } }) },
    customers: { create: async () => ({ id: "cus_int_guardian" }) },
    subscriptions: {
      list: async () => ({ data: [] }), retrieve: async (id: string) => fx.subs[id],
      update: async (id: string, p: object) => (fx.subs[id] = { ...(fx.subs[id] as object), ...p }),
    },
    checkout: { sessions: { create: async () => ({ id: "cs_int", url: "https://checkout.stripe.com/c/cs_int" }) } },
    identity: {
      verificationSessions: {
        create: async () => { const id = `vs_int_${++fx.n}`; fx.vs[id] = { status: "requires_input", dob: null }; return { id, url: `https://verify.stripe.com/${id}` }; },
        retrieve: async (id: string) => ({ id, status: fx.vs[id].status, last_error: null, verified_outputs: { dob: fx.vs[id].dob } }),
      },
    },
  }),
}));

import * as registrationRoute from "@/app/api/registration/route";
import * as teenInviteRoute from "@/app/api/registration/guardian/route";
import * as guardianAccountRoute from "@/app/api/registration/guardian-account/route";
import * as identityRoute from "@/app/api/v1/guardian/identity/route";
import * as consentRoute from "@/app/api/v1/guardian/teens/[accountId]/consent/route";
import * as withdrawRoute from "@/app/api/v1/guardian/teens/[accountId]/withdraw/route";
import * as checkoutRoute from "@/app/api/v1/billing/checkout/route";
import * as webhookRoute from "@/app/api/webhooks/stripe/route";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);

beforeAll(async () => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
}, 60_000);
afterAll(() => stack?.stop());

const t = usToday();
const fifteen = isoDate({ y: t.y - 15, m: t.m, d: t.d });
function signIn(id: string, email: string, meta?: Record<string, unknown>) {
  const u = clerkUser({ id, email, passwordEnabled: true, twoFactorEnabled: true }) as unknown as Record<string, unknown>;
  if (meta) u.public_metadata = meta;
  clerk.users[id] = u;
  clerk.userId = id;
}
const post = async (mod: { POST: (r: Request) => Promise<Response> }, body: unknown) => {
  const res = await mod.POST(new Request("https://ascentra.test/api/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const idOf = async (clerkId: string) => (await q("select id from public.accounts where clerk_user_id = $1", [clerkId])).rows[0].id as string;
async function api(mod: Record<string, unknown>, url: string, clerkId: string, body: unknown, params: Record<string, string> = {}) {
  clerk.userId = clerkId;
  const id = await idOf(clerkId);
  const d = trustedDeviceRow(id);
  await q(`insert into public.trusted_devices (account_id, name, kind, trust_state, device_key_hash, trusted_at, last_seen_at)
           select $1, $2, 'laptop', 'trusted', $3, now(), now() where not exists (select 1 from public.trusted_devices where account_id = $1)`, [id, d.name, d.device_key_hash]);
  const res = await (mod.POST as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method: "POST", headers: { "content-type": "application/json", cookie: deviceCookie(id) }, body: JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
let seq = 0;
async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_int_${++seq}`, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return { status: res.status, body: await res.json() };
}

describe("the Guardian flow on the real database", () => {
  let teenId: string;
  let guardianId: string;

  it("teen invites → Guardian signs up → identity verified → agrees → pays → the teen is active", async () => {
    signIn("user_int_teen", "int.teen@example.com");
    await post(registrationRoute, { dateOfBirth: fifteen, usResident: true });
    expect((await post(teenInviteRoute, { guardianEmail: "int.mom@example.com" })).status).toBe(201);
    teenId = await idOf("user_int_teen");
    const link = (await q("select id from public.guardian_relationships where teen_account_id = $1", [teenId])).rows[0].id;

    signIn("user_int_mom", "int.mom@example.com", { ascentra_guardian_invite_id: link });
    expect((await post(guardianAccountRoute, { adult: true, usResident: true, relationship: "parent" })).body).toEqual({ state: "ready", home: "/guardian" });
    guardianId = await idOf("user_int_mom");

    expect((await api(identityRoute, "/api/v1/guardian/identity", "user_int_mom", {})).status).toBe(200);
    const vs = (await q("select identity_session_id from public.accounts where id = $1", [guardianId])).rows[0].identity_session_id;
    fx.vs[vs] = { status: "verified", dob: { day: 1, month: 1, year: 1980 } };
    expect((await deliver("identity.verification_session.verified", { id: vs, metadata: { account_id: guardianId, purpose: "ascentra_guardian" } })).body.outcome).toBe("identity_verified");

    const params = { accountId: teenId };
    expect((await api(consentRoute, `/api/v1/guardian/teens/${teenId}/consent`, "user_int_mom", { agreed: { teen_terms: "v0.2", minor_privacy_notice: "v0.2" } }, params)).status).toBe(200);
    expect((await api(checkoutRoute, "/api/v1/billing/checkout", "user_int_mom", { plan: "basic", agreed: true, termsVersion: RENEWAL_TERMS_VERSION, usResident: true, teenAccountId: teenId })).status).toBe(200);

    const now = Math.floor(Date.now() / 1000);
    fx.subs.sub_int = {
      id: "sub_int", object: "subscription", customer: "cus_int_guardian", status: "active", start_date: now, cancel_at_period_end: false, cancel_at: null,
      canceled_at: null, ended_at: null, trial_start: null, trial_end: null, metadata: { account_id: guardianId, beneficiary_account_id: teenId },
      items: { object: "list", data: [{ price: { id: ENV.STRIPE_PRICE_BASIC }, current_period_start: now, current_period_end: now + 30 * 86_400 }] },
    };
    const done = await deliver("checkout.session.completed", {
      id: "cs_int", object: "checkout.session", mode: "subscription", subscription: "sub_int", customer: "cus_int_guardian",
      client_reference_id: guardianId, metadata: { account_id: guardianId, beneficiary_account_id: teenId }, customer_details: { address: { country: "US" } },
    });
    expect(done.body.outcome).toMatch(/teen_activated/);
    expect((await q("select status from public.accounts where id = $1", [teenId])).rows[0].status).toBe("active");
    expect((await q("select payer_account_id, beneficiary_account_id from public.subscriptions")).rows).toEqual([{ payer_account_id: guardianId, beneficiary_account_id: teenId }]);
    expect((await q("select relation, status from public.consent_records where account_id = $1 order by created_at", [teenId])).rows)
      .toEqual([{ relation: "guardian_for_teen", status: "given" }, { relation: "guardian_for_teen", status: "given" }, { relation: "guardian_for_teen", status: "given" }]);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });

  it("withdrawal pauses the teen on the real database; consent rows stay, a withdrawal row is added for each", async () => {
    const r = await api(withdrawRoute, `/api/v1/guardian/teens/${teenId}/withdraw`, "user_int_mom", { reason: "Taking a break from it" }, { accountId: teenId });
    expect(r.status).toBe(200);
    expect((await q("select status from public.accounts where id = $1", [teenId])).rows[0].status).toBe("paused");
    expect((await q("select status, count(*)::int as n from public.consent_records where account_id = $1 group by status order by status", [teenId])).rows)
      .toEqual([{ status: "given", n: 3 }, { status: "withdrawn", n: 3 }]);
    signIn("user_int_teen", "int.teen@example.com");
    const res = await registrationRoute.GET();
    expect((await res.json()).state).toBe("paused");
  });
});
