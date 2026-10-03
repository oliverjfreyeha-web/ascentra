/**
 * B4 against real Postgres behind PostgREST: notices and privacy requests pass the database's own rules
 * (dedupe key, one open deletion, due dates). Resend isn't configured here, so notices are recorded as skipped.
 */
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";

const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
const ENV = { STRIPE_SECRET_KEY: "sk_test_b4i", STRIPE_WEBHOOK_SECRET: "whsec_b4i", STRIPE_PRICE_BASIC: "price_b4i_basic", STRIPE_PRICE_PRO: "price_b4i_pro", STRIPE_PORTAL_CONFIG: "bpc_b4i" };
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const fx = vi.hoisted(() => ({ subs: {} as Record<string, unknown> }));
vi.mock("@/lib/billing-env", async (orig) => ({
  ...(await orig<object>()),
  stripeClient: () => ({ webhooks: real.webhooks, subscriptions: { retrieve: async (id: string) => fx.subs[id] } }),
}));

import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import * as exportRoute from "@/app/api/v1/privacy/export/route";
import * as deletionRoute from "@/app/api/v1/privacy/deletion/route";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
beforeAll(async () => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("RESEND_API_KEY", "");
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  await q("insert into public.billing_customers (account_id, processor_customer_id) values ($1, 'cus_b4i')", [ROLE_ID.learner]);
}, 60_000);
afterAll(() => stack?.stop());

let seq = 0;
async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_b4i_${++seq}`, object: "event", type, created: Math.floor(Date.now() / 1000) + seq, data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return { status: res.status, body: await res.json() };
}
const now = Math.floor(Date.now() / 1000);
const sub = (status: string) => ({
  id: "sub_b4i", object: "subscription", customer: "cus_b4i", status, start_date: now - 86_400, cancel_at_period_end: false, cancel_at: null,
  canceled_at: null, ended_at: null, trial_start: null, trial_end: null, metadata: { account_id: ROLE_ID.learner },
  items: { object: "list", data: [{ price: { id: ENV.STRIPE_PRICE_BASIC }, current_period_start: now, current_period_end: now + 30 * 86_400 }] },
});
async function call(mod: Record<string, unknown>, url: string, body: unknown) {
  session.userId = clerkIdOf("learner");
  const res = await (mod.POST as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method: "POST", headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID.learner) }, body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { status: res.status, body: await res.json() };
}

describe("B4 on the real database", () => {
  it("records a failed-payment notice once per invoice (skipped: email not configured)", async () => {
    fx.subs.sub_b4i = sub("active");
    await deliver("customer.subscription.created", fx.subs.sub_b4i);
    fx.subs.sub_b4i = sub("past_due");
    const inv = { id: "in_b4i", object: "invoice", amount_due: 2000, parent: { subscription_details: { subscription: "sub_b4i" } } };
    expect((await deliver("invoice.payment_failed", inv)).status).toBe(200);
    expect((await deliver("invoice.payment_failed", inv)).status).toBe(200);
    const { rows } = await q("select kind, status, account_id from public.notices");
    expect(rows).toEqual([{ kind: "payment_failed", status: "skipped", account_id: ROLE_ID.learner }]);
  });

  it("an export is recorded as completed; one open deletion request at a time, with a due date", async () => {
    expect((await call(exportRoute, "/api/v1/privacy/export", {})).status).toBe(200);
    expect((await call(deletionRoute, "/api/v1/privacy/deletion", {})).status).toBe(201);
    expect((await call(deletionRoute, "/api/v1/privacy/deletion", {})).status).toBe(409);
    const { rows } = await q("select kind, status, due_at > now() + interval '44 days' as due_later from public.privacy_requests order by created_at");
    expect(rows).toEqual([{ kind: "export", status: "completed", due_later: true }, { kind: "deletion", status: "open", due_later: true }]);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });
});
