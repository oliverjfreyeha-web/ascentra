/**
 * B4 through the real routes (database faked in memory, Clerk mocked, Stripe faked, Resend's HTTP API stubbed):
 *   notices (payment failed, canceled, ended, trial ending, renewal, consent withdrawn), each sent once;
 *   the payment-failed banner; a teen never loses access before the Guardian is told; cancel in two steps;
 *   the Privacy Center; Owner-only refunds and credits.
 */
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie, trustedDeviceRow } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner", verified: true }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_b4", has: () => session.verified })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));
const stripe = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/lib/billing-env", async (orig) => ({ ...(await orig<object>()), stripeClient: () => stripe.api }));

import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import * as alertsRoute from "@/app/api/v1/billing/alerts/route";
import * as cancelRoute from "@/app/api/v1/billing/cancel/route";
import * as privacyRoute from "@/app/api/v1/privacy/route";
import * as exportRoute from "@/app/api/v1/privacy/export/route";
import * as deletionRoute from "@/app/api/v1/privacy/deletion/route";
import * as withdrawRoute from "@/app/api/v1/privacy/consents/[id]/withdraw/route";
import * as adjustmentsRoute from "@/app/api/v1/billing/adjustments/route";
import * as refundRoute from "@/app/api/v1/billing/adjustments/[accountId]/refund/route";
import * as creditRoute from "@/app/api/v1/billing/adjustments/[accountId]/credit/route";
import * as cronRoute from "@/app/api/cron/notices/route";
import { noticeConsentWithdrawn } from "@/lib/notices";
import { RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_b4", STRIPE_WEBHOOK_SECRET: "whsec_b4", STRIPE_PRICE_BASIC: "price_basic_b4",
  STRIPE_PRICE_PRO: "price_pro_b4", STRIPE_PORTAL_CONFIG: "bpc_b4",
  RESEND_API_KEY: "re_b4_not_a_real_key", NOTICE_FROM_EMAIL: "ASCENTRA <notices@ascentra.test>",
};
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const LEARNER = ROLE_ID.learner;
const GUARDIAN = ROLE_ID.guardian;
const TEEN = "00000000-0000-4000-8000-0000000000aa";

type Db = ReturnType<typeof seedFake>;
let db: Db;
let subs: Record<string, Stripe.Subscription>;
let sent: { to: string[]; subject: string; text: string; key: string; subStatusAtSend?: unknown }[];
let resendFails = false;
let calls: { portal: Record<string, unknown>[]; updates: [string, Record<string, unknown>][]; refunds: Record<string, unknown>[]; credits: [string, Record<string, unknown>][] };

function sub(id: string, o: Partial<Stripe.Subscription> & { periodEnd?: number; payer?: string; beneficiary?: string } = {}): Stripe.Subscription {
  const { periodEnd = now() + 30 * DAY, payer = LEARNER, beneficiary = payer, ...rest } = o;
  return {
    id, object: "subscription", customer: payer === LEARNER ? "cus_learner" : "cus_guardian", status: "active", start_date: now() - DAY, cancel_at_period_end: false,
    cancel_at: null, canceled_at: null, ended_at: null, trial_start: null, trial_end: null,
    metadata: { account_id: payer, beneficiary_account_id: beneficiary },
    items: { object: "list", data: [{ price: { id: ENV.STRIPE_PRICE_BASIC }, current_period_start: now() - DAY, current_period_end: periodEnd }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "ascentra.test");
  db = seedFake();
  db.data.legal_document_versions = [{ id: "doc-art", document_key: RENEWAL_TERMS_KEY, version: RENEWAL_TERMS_VERSION, title: "Automatic Renewal Terms", status: "published" }];
  db.data.billing_customers = [{ account_id: LEARNER, processor_customer_id: "cus_learner" }, { account_id: GUARDIAN, processor_customer_id: "cus_guardian" }];
  // A teen whose Guardian of record (the seeded Guardian) pays.
  db.data.accounts.push({ id: TEEN, clerk_user_id: "user_teen", email: "teen@example.com", email_verified: true, role: "learner", status: "active", is_minor: true,
    password_enabled: false, two_factor_enabled: false, clerk_updated_at: "2026-09-01T00:00:00.000Z" });
  db.data.profiles.push({ account_id: TEEN, display_name: "Tess Teen" });
  db.data.trusted_devices.push(trustedDeviceRow(TEEN));
  db.data.guardian_relationships = [{ id: "link-1", teen_account_id: TEEN, guardian_account_id: GUARDIAN, verification_status: "verified", withdrawn_at: null, authorized_at: "2026-09-01T00:00:00.000Z" }];
  fake.db = db;
  subs = {};
  sent = [];
  resendFails = false;
  calls = { portal: [], updates: [], refunds: [], credits: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.resend.com/emails");
    if (resendFails) return new Response(JSON.stringify({ name: "internal_server_error", message: "down" }), { status: 500 });
    const body = JSON.parse(String(init.body));
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${ENV.RESEND_API_KEY}`);
    expect(body.from).toBe(ENV.NOTICE_FROM_EMAIL);
    sent.push({ to: body.to, subject: body.subject, text: body.text, key: headers["idempotency-key"], subStatusAtSend: db.data.subscriptions?.[0]?.status });
    return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200 });
  }));
  stripe.api = {
    webhooks: real.webhooks,
    subscriptions: {
      retrieve: vi.fn(async (id: string) => subs[id]),
      update: vi.fn(async (id: string, p: Record<string, unknown>) => { calls.updates.push([id, p]); return { ...subs[id], ...p }; }),
    },
    billingPortal: { sessions: { create: vi.fn(async (p: Record<string, unknown>) => { calls.portal.push(p); return { url: "https://billing.stripe.com/p/cancel" }; }) } },
    charges: {
      list: vi.fn(async () => ({ data: [{ id: "ch_1", amount: 2000, amount_refunded: 0, status: "succeeded", paid: true, created: now(), description: null }] })),
      retrieve: vi.fn(async (id: string) => ({ id, amount: 2000, amount_refunded: 0, customer: id === "ch_other" ? "cus_someone" : "cus_learner" })),
    },
    refunds: { create: vi.fn(async (p: Record<string, unknown>) => { calls.refunds.push(p); return { id: "re_1", status: "succeeded" }; }) },
    customers: {
      retrieve: vi.fn(async () => ({ id: "cus_learner", balance: 0 })),
      createBalanceTransaction: vi.fn(async (c: string, p: Record<string, unknown>) => { calls.credits.push([c, p]); return { id: "cbtxn_1", ending_balance: p.amount }; }),
    },
  };
  session.verified = true;
});
afterEach(() => vi.unstubAllGlobals());

let seq = 0;
async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_b4_${++seq}`, object: "event", type, created: now() + seq, data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return { status: res.status, body: await res.json() };
}
const invoiceFailed = (subId: string, id = "in_1") => ({ id, object: "invoice", amount_due: 2000, parent: { subscription_details: { subscription: subId } } });
async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey | "teen", body?: unknown, params: Record<string, string> = {}) {
  const id = role === "teen" ? TEEN : ROLE_ID[role];
  session.userId = role === "teen" ? "user_teen" : clerkIdOf(role);
  const req = new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(id) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json() };
}
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);

describe("notices", () => {
  it("a failed payment: Stripe retries, the payer is emailed once, and sees a banner until it's fixed", async () => {
    subs.sub_1 = sub("sub_1");
    await deliver("customer.subscription.created", subs.sub_1);
    subs.sub_1 = sub("sub_1", { status: "past_due" });
    await deliver("invoice.payment_failed", invoiceFailed("sub_1"));
    await deliver("invoice.payment_failed", invoiceFailed("sub_1"));
    expect(sent).toEqual([expect.objectContaining({ to: ["learner@example.com"], subject: "Payment failed for your ASCENTRA plan", key: "payment_failed:in_1" })]);
    expect(sent[0].text).toMatch(/Stripe will try again[\s\S]*https:\/\/ascentra\.test\/account/);
    expect(db.data.notices).toEqual([expect.objectContaining({ kind: "payment_failed", status: "sent", account_id: LEARNER, provider_message_id: "email_1" })]);
    expect((await call(alertsRoute, "GET", "/api/v1/billing/alerts", "learner")).body.alerts).toEqual([expect.objectContaining({ kind: "payment_failed", href: "/account" })]);
    subs.sub_1 = sub("sub_1");
    await deliver("invoice.paid", { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: "sub_1" } } });
    expect((await call(alertsRoute, "GET", "/api/v1/billing/alerts", "learner")).body.alerts).toEqual([]);
  });

  it("without Resend configured, a notice is recorded as skipped (and the banner still shows); a failed send is tried again", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    subs.sub_1 = sub("sub_1", { status: "past_due" });
    await deliver("invoice.payment_failed", invoiceFailed("sub_1"));
    expect(db.data.notices[0]).toMatchObject({ status: "skipped", error: expect.stringMatching(/RESEND_API_KEY is missing/) });
    vi.stubEnv("RESEND_API_KEY", ENV.RESEND_API_KEY);
    resendFails = true;
    await deliver("invoice.payment_failed", invoiceFailed("sub_1"));
    expect(db.data.notices[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/Resend 500/) });
    resendFails = false;
    await deliver("invoice.payment_failed", invoiceFailed("sub_1"));
    expect(db.data.notices).toHaveLength(1);
    expect(db.data.notices[0]).toMatchObject({ status: "sent" });
    expect(sent).toHaveLength(1);
  });

  it("canceled (access to the period end) and ended are each emailed once", async () => {
    const end = now() + 20 * DAY;
    subs.sub_1 = sub("sub_1", { periodEnd: end });
    await deliver("customer.subscription.created", subs.sub_1);
    subs.sub_1 = sub("sub_1", { periodEnd: end, cancel_at_period_end: true });
    await deliver("customer.subscription.updated", subs.sub_1);
    await deliver("customer.subscription.updated", subs.sub_1);
    subs.sub_1 = sub("sub_1", { periodEnd: end, status: "canceled", ended_at: now(), canceled_at: now() });
    await deliver("customer.subscription.deleted", subs.sub_1);
    expect(sent.map((s) => s.subject)).toEqual(["Your ASCENTRA plan is canceled", "Your ASCENTRA plan has ended"]);
    expect(sent[0].text).toMatch(/You keep access until [\s\S]* you won.t be charged again/);
  });

  it("a teen's plan: the Guardian is the one emailed and warned, and is told before the teen loses access", async () => {
    subs.sub_t = sub("sub_t", { payer: GUARDIAN, beneficiary: TEEN });
    await deliver("customer.subscription.created", subs.sub_t);
    expect(db.data.subscriptions[0]).toMatchObject({ payer_account_id: GUARDIAN, beneficiary_account_id: TEEN });
    subs.sub_t = sub("sub_t", { payer: GUARDIAN, beneficiary: TEEN, status: "past_due" });
    await deliver("invoice.payment_failed", invoiceFailed("sub_t", "in_t"));
    expect(sent[0]).toMatchObject({ to: ["guardian@example.com"], subject: "Payment failed for Tess's ASCENTRA plan" });
    expect((await call(alertsRoute, "GET", "/api/v1/billing/alerts", "guardian")).body.alerts[0]).toMatchObject({ href: "/guardian", message: expect.stringMatching(/Tess's plan failed/) });
    expect((await call(alertsRoute, "GET", "/api/v1/billing/alerts", "teen")).body.alerts[0].message).toMatch(/Your Guardian has been told/);
    // Every retry failed: Stripe ends the plan. The Guardian's email goes out while the plan is still recorded as live.
    subs.sub_t = sub("sub_t", { payer: GUARDIAN, beneficiary: TEEN, status: "canceled", ended_at: now() });
    await deliver("customer.subscription.deleted", subs.sub_t);
    const ended = sent.find((s) => s.subject === "Tess's ASCENTRA plan has ended")!;
    expect(ended).toMatchObject({ to: ["guardian@example.com"], subStatusAtSend: "past_due" });
    expect(db.data.subscriptions[0].status).toBe("ended");
    expect(sent.filter((s) => s.subject.includes("has ended"))).toHaveLength(1);
  });

  it("the daily job sends trial-ending and renewal reminders inside their windows (placeholders), once", async () => {
    const at = (days: number) => new Date(Date.now() + days * DAY * 1000).toISOString();
    db.data.subscriptions = [
      { id: "s-trial", payer_account_id: LEARNER, beneficiary_account_id: LEARNER, plan: "trial", status: "trialing", trial_ends_at: at(2), renews_at: at(2) },
      { id: "s-trial-later", payer_account_id: LEARNER, beneficiary_account_id: LEARNER, plan: "trial", status: "trialing", trial_ends_at: at(10), renews_at: at(10) },
      { id: "s-renew", payer_account_id: GUARDIAN, beneficiary_account_id: TEEN, plan: "pro", status: "active", renews_at: at(5) },
      { id: "s-canceled", payer_account_id: LEARNER, beneficiary_account_id: LEARNER, plan: "basic", status: "canceled", renews_at: at(5) },
    ];
    const cron = (auth?: string) => cronRoute.GET(new Request("https://ascentra.test/api/cron/notices", { headers: auth ? { authorization: auth } : {} }));
    expect((await cron()).status).toBe(401);
    const r = await (await cron(`Bearer ${TEST_ENV.CRON_SECRET}`)).json();
    expect(r.notices).toEqual({ sent: 2 });
    expect(sent.map((s) => s.subject)).toEqual([
      expect.stringMatching(/^Your ASCENTRA free trial ends on /),
      expect.stringMatching(/^Tess's ASCENTRA plan renews on /),
    ]);
    expect(sent[0].text).toMatch(/converts to Basic and you are charged \$20\.00/);
    expect(sent[1].to).toEqual(["guardian@example.com"]);
    await cron(`Bearer ${TEST_ENV.CRON_SECRET}`);
    expect(sent).toHaveLength(2);
  });

  it("a Guardian's consent withdrawal is emailed to both", async () => {
    await noticeConsentWithdrawn(GUARDIAN, TEEN, new Date().toISOString());
    expect(sent.map((s) => [s.to[0], s.subject])).toEqual([
      ["guardian@example.com", "You withdrew consent for Tess's ASCENTRA account"],
      ["teen@example.com", "Your ASCENTRA account is paused"],
    ]);
  });
});

describe("cancel", () => {
  beforeEach(async () => {
    subs.sub_1 = sub("sub_1");
    await deliver("customer.subscription.created", subs.sub_1);
  });

  it("opens Stripe's cancellation page for this plan directly, without a second-factor step", async () => {
    session.verified = false;
    const r = await call(cancelRoute, "POST", "/api/v1/billing/cancel", "learner", {});
    expect(r).toEqual({ status: 200, body: { url: "https://billing.stripe.com/p/cancel" } });
    expect(calls.portal[0]).toMatchObject({
      customer: "cus_learner", configuration: ENV.STRIPE_PORTAL_CONFIG,
      flow_data: { type: "subscription_cancel", subscription_cancel: { subscription: "sub_1" }, after_completion: { redirect: { return_url: "https://ascentra.test/account?billing=canceled_plan" } } },
    });
    expect(audit("billing.cancel")).toHaveLength(1);
  });

  it("a teen can't cancel (the Guardian does); a plan already canceled says until when; no plan → 404", async () => {
    expect((await call(cancelRoute, "POST", "/api/v1/billing/cancel", "teen", {})).status).toBe(403);
    subs.sub_1 = sub("sub_1", { cancel_at_period_end: true });
    await deliver("customer.subscription.updated", subs.sub_1);
    expect((await call(cancelRoute, "POST", "/api/v1/billing/cancel", "learner", {})).body.reason).toMatch(/already canceled. Access continues until/);
    expect((await call(cancelRoute, "POST", "/api/v1/billing/cancel", "guardian", {})).status).toBe(404);
  });
});

describe("the Privacy Center", () => {
  beforeEach(() => {
    db.data.consent_records = [
      { id: "11111111-1111-4111-8111-111111111111", account_id: LEARNER, actor_account_id: LEARNER, relation: "self", legal_document_version_id: "doc-art",
        status: "given", method: "Separate recurring-billing checkbox before checkout", consented_at: "2026-09-02T00:00:00.000Z", created_at: "2026-09-02T00:00:00.000Z" },
    ];
    db.data.subscriptions = [{ id: "s1", payer_account_id: LEARNER, beneficiary_account_id: LEARNER, plan: "basic", status: "active",
      processor_subscription_id: "sub_1", cancel_at_period_end: false, renews_at: "2026-11-01T00:00:00.000Z", created_at: "2026-09-02T00:00:00.000Z" }];
  });

  it("lists each document and version agreed to; withdrawing recurring billing ends the plan at the period end", async () => {
    const view = await call(privacyRoute, "GET", "/api/v1/privacy", "learner");
    expect(view.body.consents).toEqual([expect.objectContaining({ title: "Automatic Renewal Terms", version: RENEWAL_TERMS_VERSION, status: "given", for: "You", withdraw: "here" })]);
    const w = await call(withdrawRoute, "POST", "/api/v1/privacy/consents/11111111-1111-4111-8111-111111111111/withdraw", "learner", {}, { id: "11111111-1111-4111-8111-111111111111" });
    expect(w.status).toBe(200);
    expect(calls.updates).toEqual([["sub_1", { cancel_at_period_end: true }]]);
    expect(db.data.consent_records.map((c) => c.status)).toEqual(["given", "withdrawn"]);
    expect((await call(withdrawRoute, "POST", "/api/v1/privacy/consents/11111111-1111-4111-8111-111111111111/withdraw", "learner", {}, { id: "11111111-1111-4111-8111-111111111111" })).status).toBe(409);
    expect(audit("privacy.consent.withdraw").at(-1)).toMatchObject({ result: "blocked" });
  });

  it("downloads my data as JSON and records the request as completed; needs the second factor", async () => {
    session.verified = false;
    expect((await call(exportRoute, "POST", "/api/v1/privacy/export", "learner", {})).body.clerk_error).toBeDefined();
    session.verified = true;
    const r = await call(exportRoute, "POST", "/api/v1/privacy/export", "learner", {});
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ account: { id: LEARNER, email: "learner@example.com" }, consents: [expect.objectContaining({ legal_document_version_id: "doc-art" })] });
    expect(JSON.stringify(r.body.data)).not.toMatch(/device_key_hash|identity_session_id/);
    expect(db.data.privacy_requests).toEqual([expect.objectContaining({ kind: "export", status: "completed", account_id: LEARNER, due_at: expect.any(String) })]);
    expect(audit("privacy.export")).toEqual([expect.objectContaining({ result: "completed" })]);
  });

  it("requests deletion with a due date (one open at a time); the Owner can't; a teen's is handled by the Guardian", async () => {
    const r = await call(deletionRoute, "POST", "/api/v1/privacy/deletion", "learner", { note: "Please delete" });
    expect(r.status).toBe(201);
    const days = (Date.parse(r.body.dueAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(44);
    expect((await call(deletionRoute, "POST", "/api/v1/privacy/deletion", "learner", {})).status).toBe(409);
    expect((await call(deletionRoute, "POST", "/api/v1/privacy/deletion", "owner", {})).status).toBe(403);
    expect((await call(deletionRoute, "POST", "/api/v1/privacy/deletion", "teen", {})).body.reason).toMatch(/Your Guardian handles/);
    expect((await call(exportRoute, "POST", "/api/v1/privacy/export", "teen", {})).status).toBe(403);
    // The teen's Guardian of record can ask for them; nobody else can.
    expect((await call(deletionRoute, "POST", "/api/v1/privacy/deletion", "guardian", { forAccountId: TEEN })).status).toBe(201);
    expect((await call(exportRoute, "POST", "/api/v1/privacy/export", "learner", { forAccountId: TEEN })).status).toBe(404);
    expect(db.data.privacy_requests.filter((p) => p.kind === "deletion").map((p) => [p.account_id, p.status])).toEqual([[LEARNER, "open"], [TEEN, "open"]]);
  });
});

describe("refunds and credits", () => {
  it("are the Owner's only, need a reason, and are audited", async () => {
    for (const role of ["superAdmin", "support", "learner"] as RoleKey[]) {
      expect((await call(refundRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/refund`, role, { chargeId: "ch_1", reason: "Asked for it" }, { accountId: LEARNER })).status, role).toBe(403);
      expect((await call(adjustmentsRoute, "GET", "/api/v1/billing/adjustments?q=learner@example.com", role)).status, role).toBe(403);
    }
    expect((await call(refundRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/refund`, "owner", { chargeId: "ch_1" }, { accountId: LEARNER })).status).toBe(400);
    const look = await call(adjustmentsRoute, "GET", "/api/v1/billing/adjustments?q=learner@example.com", "owner");
    expect(look.body.charges).toEqual([expect.objectContaining({ id: "ch_1", amountCents: 2000 })]);

    expect((await call(refundRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/refund`, "owner", { chargeId: "ch_other", reason: "Wrong account test" }, { accountId: LEARNER })).status).toBe(404);
    expect((await call(refundRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/refund`, "owner", { chargeId: "ch_1", amountCents: 2500, reason: "Too much" }, { accountId: LEARNER })).status).toBe(400);
    const r = await call(refundRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/refund`, "owner", { chargeId: "ch_1", amountCents: 1000, reason: "Billing error last month" }, { accountId: LEARNER });
    expect(r).toMatchObject({ status: 200, body: { amountCents: 1000 } });
    expect(calls.refunds[0]).toMatchObject({ charge: "ch_1", amount: 1000, metadata: { ascentra_reason: "Billing error last month" } });

    expect((await call(creditRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/credit`, "owner", { amountCents: 999_999, reason: "Goodwill credit" }, { accountId: LEARNER })).status).toBe(400);
    const c = await call(creditRoute, "POST", `/api/v1/billing/adjustments/${LEARNER}/credit`, "owner", { amountCents: 500, reason: "Goodwill credit" }, { accountId: LEARNER });
    expect(c.status).toBe(200);
    expect(calls.credits[0]).toEqual(["cus_learner", expect.objectContaining({ amount: -500, currency: "usd" })]);
    expect(audit("billing.refund").filter((e) => e.result === "completed")).toEqual([expect.objectContaining({ reason: "Billing error last month", is_sensitive: true })]);
    expect(audit("billing.credit").filter((e) => e.result === "completed")).toEqual([expect.objectContaining({ reason: "Goodwill credit" })]);
  });
});
