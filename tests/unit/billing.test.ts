/**
 * B1 billing, through the real routes (database faked in memory, Clerk mocked, Stripe faked; webhook
 * signatures are made and checked with Stripe's own library):
 *   - checkout needs the Automatic Renewal Terms agreed in the version shown, stores the consent first,
 *     gives the 14-day trial on the first Basic subscription only, and refuses a price that isn't locked;
 *   - the webhook verifies the signature, applies each event once, and keeps subscriptions and
 *     entitlements in step through trialing, active, past_due, canceled and ended; US only;
 *   - Pro-only routes refuse Basic and trial with 403; the entitlement is read from the database;
 *   - every billing change is audited.
 */
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner", verified: true }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_b1", has: () => session.verified })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));
const stripe = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/lib/billing-env", async (orig) => ({ ...(await orig<object>()), stripeClient: () => stripe.api }));

import * as billingRoute from "@/app/api/v1/billing/route";
import * as checkoutRoute from "@/app/api/v1/billing/checkout/route";
import * as portalRoute from "@/app/api/v1/billing/portal/route";
import * as proRoute from "@/app/api/v1/pro/route";
import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import { entitlementOf, mapSubscription, PRO_REQUIRED } from "@/lib/billing";
import { RENEWAL_TERMS_BODY, RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_b1_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_b1_test_secret",
  STRIPE_PRICE_BASIC: "price_basic_test",
  STRIPE_PRICE_PRO: "price_pro_test",
  STRIPE_PORTAL_CONFIG: "bpc_test",
};
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const LEARNER = ROLE_ID.learner;
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

type Db = ReturnType<typeof seedFake>;
let db: Db;
let subs: Record<string, Stripe.Subscription>;
let prices: Record<string, Partial<Stripe.Price>>;
let calls: { checkout: Record<string, unknown>[]; cancel: string[]; customers: number; portal: Record<string, unknown>[] };

function sub(id: string, o: Partial<Stripe.Subscription> & { price?: string; periodEnd?: number } = {}): Stripe.Subscription {
  const { price = ENV.STRIPE_PRICE_BASIC, periodEnd = now() + 30 * DAY, ...rest } = o;
  return {
    id, object: "subscription", customer: "cus_learner", status: "active", start_date: now(), cancel_at_period_end: false,
    cancel_at: null, canceled_at: null, ended_at: null, trial_start: null, trial_end: null, metadata: { account_id: LEARNER },
    items: { object: "list", data: [{ price: { id: price }, current_period_start: now(), current_period_end: periodEnd }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}

function fakeStripe() {
  return {
    webhooks: real.webhooks,
    prices: { retrieve: vi.fn(async (id: string) => ({ id, ...prices[id] })) },
    customers: { create: vi.fn(async () => { calls.customers++; return { id: "cus_learner" }; }) },
    subscriptions: {
      list: vi.fn(async () => ({ data: Object.values(subs) })),
      retrieve: vi.fn(async (id: string) => subs[id]),
      cancel: vi.fn(async (id: string) => {
        calls.cancel.push(id);
        subs[id] = { ...subs[id], status: "canceled", canceled_at: now(), ended_at: now() };
        return subs[id];
      }),
    },
    checkout: { sessions: { create: vi.fn(async (p: Record<string, unknown>) => { calls.checkout.push(p); return { id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }; }) } },
    billingPortal: { sessions: { create: vi.fn(async (p: Record<string, unknown>) => { calls.portal.push(p); return { url: "https://billing.stripe.com/p/1" }; }) } },
  };
}

beforeEach(() => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  db = seedFake();
  db.data.legal_document_versions = [{ id: "doc-art-v01", document_key: RENEWAL_TERMS_KEY, version: RENEWAL_TERMS_VERSION, status: "published", body: RENEWAL_TERMS_BODY }];
  fake.db = db;
  subs = {};
  prices = {
    [ENV.STRIPE_PRICE_BASIC]: { active: true, currency: "usd", unit_amount: 2000, type: "recurring", recurring: { interval: "month", interval_count: 1 } as Stripe.Price.Recurring },
    [ENV.STRIPE_PRICE_PRO]: { active: true, currency: "usd", unit_amount: 5000, type: "recurring", recurring: { interval: "month", interval_count: 1 } as Stripe.Price.Recurring },
  };
  calls = { checkout: [], cancel: [], customers: 0, portal: [] };
  stripe.api = fakeStripe();
  session.userId = clerkIdOf("learner");
  session.verified = true;
});

const as = (role: RoleKey) => {
  session.userId = clerkIdOf(role);
  return ROLE_ID[role];
};
function call(mod: Record<string, unknown>, method: string, url: string, body?: unknown, role: RoleKey = "learner") {
  const id = as(role);
  const req = new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(id), "user-agent": "B1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (mod[method] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({}) });
}
const AGREE = { agreed: true, termsVersion: RENEWAL_TERMS_VERSION, usResident: true };
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);

let seq = 0;
async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_${++seq}`, object: "event", type, created: now(), data: { object } });
  return deliverRaw(payload);
}
async function deliverRaw(payload: string, secret = ENV.STRIPE_WEBHOOK_SECRET) {
  const header = real.webhooks.generateTestHeaderString({ payload, secret });
  const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return { status: res.status, body: (await res.json()) as { outcome?: string; error?: string } };
}
const completed = (subId: string, country = "US") => ({
  id: "cs_1", object: "checkout.session", mode: "subscription", subscription: subId, customer: "cus_learner",
  client_reference_id: LEARNER, metadata: { account_id: LEARNER, consent_record_id: db.data.consent_records?.[0]?.id },
  customer_details: { address: { country } },
});

describe("Stripe's lifecycle, as our rows (pure)", () => {
  const env = { STRIPE_PRICE_BASIC: ENV.STRIPE_PRICE_BASIC, STRIPE_PRICE_PRO: ENV.STRIPE_PRICE_PRO };
  it.each([
    ["trialing", {}, "trial", "trialing", "trial"],
    ["active", {}, "basic", "active", "basic"],
    ["active", { cancel_at_period_end: true }, "basic", "canceled", "basic"],
    ["past_due", {}, "basic", "past_due", "basic"],
    ["unpaid", {}, "basic", "past_due", "basic"],
    ["canceled", { ended_at: 1 }, "basic", "ended", "none"],
    ["incomplete_expired", {}, "basic", "ended", "none"],
  ] as const)("%s %j → %s / %s, tier %s", (status, extra, plan, ours, tier) => {
    const trialEnd = status === "trialing" ? now() + 14 * DAY : null;
    const m = mapSubscription(sub("sub_x", { status, trial_end: trialEnd, ...extra }), env);
    expect("row" in m && m.row).toMatchObject({ plan, status: ours });
    if ("row" in m) expect(entitlementOf({ ...m.row }).tier).toBe(tier);
  });
  it("records nothing for a subscription whose first payment hasn't gone through", () => {
    expect(mapSubscription(sub("sub_x", { status: "incomplete" }), env)).toEqual({ skip: "status incomplete" });
  });
  it("refuses a price that isn't Basic or Pro", () => {
    expect(mapSubscription(sub("sub_x", { price: "price_other" }), env)).toMatchObject({ error: expect.stringContaining("price_other") });
  });
  it("gives Pro only for the Pro price", () => {
    const m = mapSubscription(sub("sub_x", { price: ENV.STRIPE_PRICE_PRO }), env);
    expect("row" in m && m.row.plan).toBe("pro");
  });
});

describe("checkout", () => {
  it("refuses without the Automatic Renewal Terms agreed in the version shown, and stores nothing", async () => {
    for (const body of [{ plan: "basic" }, { plan: "basic", agreed: true, termsVersion: "v0.0", usResident: true }, { plan: "basic", agreed: "yes", termsVersion: RENEWAL_TERMS_VERSION, usResident: true }]) {
      const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", body);
      expect(res.status).toBe(400);
    }
    expect(db.data.consent_records ?? []).toHaveLength(0);
    expect(calls.checkout).toHaveLength(0);
    expect(audit("billing.subscribe").every((e) => e.result === "blocked")).toBe(true);
  });

  it("refuses outside the US and for a plan that doesn't exist", async () => {
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic", usResident: false })).status).toBe(400);
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "enterprise" })).status).toBe(400);
    expect(calls.checkout).toHaveLength(0);
  });

  it("first Basic: stores the consent with the document version, then opens checkout with a 14-day trial", async () => {
    const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/cs_1", trial: true });
    expect(db.data.consent_records).toEqual([expect.objectContaining({
      account_id: LEARNER, actor_account_id: LEARNER, relation: "self", legal_document_version_id: "doc-art-v01", status: "given",
    })]);
    const p = calls.checkout[0] as { subscription_data: Record<string, unknown>; line_items: unknown; billing_address_collection: string; custom_text: { submit: { message: string } } };
    expect(p.line_items).toEqual([{ price: ENV.STRIPE_PRICE_BASIC, quantity: 1 }]);
    expect(p.subscription_data).toMatchObject({ trial_period_days: 14, metadata: { account_id: LEARNER, plan: "basic" } });
    expect(p.billing_address_collection).toBe("required");
    expect(p.custom_text.submit.message).toMatch(/\$20\.00 every month until I cancel/);
    expect(audit("billing.subscribe")).toEqual([expect.objectContaining({ result: "completed", actor_account_id: LEARNER })]);
    expect(db.data.billing_customers).toEqual([expect.objectContaining({ account_id: LEARNER, processor_customer_id: "cus_learner" })]);
  });

  it("Pro: charged today, no trial", async () => {
    const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "pro" });
    expect(await res.json()).toMatchObject({ trial: false });
    expect((calls.checkout[0] as { subscription_data: Record<string, unknown> }).subscription_data.trial_period_days).toBeUndefined();
  });

  it("no second trial: after a first subscription has ended, Basic starts without one", async () => {
    await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" });
    subs.sub_1 = sub("sub_1", { status: "canceled", ended_at: now(), canceled_at: now() });
    await deliver("customer.subscription.deleted", subs.sub_1);
    const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" });
    expect(await res.json()).toMatchObject({ trial: false });
  });

  it("refuses a second plan while one is live (change it in the portal instead)", async () => {
    subs.sub_1 = sub("sub_1");
    await deliver("customer.subscription.created", subs.sub_1);
    const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "pro" });
    expect(res.status).toBe(409);
  });

  it("refuses when Stripe's price isn't the locked price, before any charge", async () => {
    prices[ENV.STRIPE_PRICE_PRO] = { ...prices[ENV.STRIPE_PRICE_PRO], unit_amount: 4000 };
    const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "pro" });
    expect(res.status).toBe(503);
    expect(calls.checkout).toHaveLength(0);
  });

  it("refuses when the stored terms differ from the terms shown", async () => {
    db.data.legal_document_versions[0].body = "Something else";
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" })).status).toBe(503);
    expect(db.data.consent_records ?? []).toHaveLength(0);
  });

  it("answers 503 when Stripe isn't configured, and never contacts it", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" });
    expect(res.status).toBe(503);
    expect(calls.checkout).toHaveLength(0);
  });

  it("staff and guardians can't subscribe; the Owner has full access and isn't offered a plan", async () => {
    for (const role of ["owner", "superAdmin", "support", "guardian"] as RoleKey[]) {
      expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" }, role)).status, role).toBe(403);
    }
  });
});

describe("the Stripe webhook", () => {
  it("refuses a missing or wrong signature and changes nothing", async () => {
    const payload = JSON.stringify({ id: "evt_x", object: "event", type: "customer.subscription.created", created: now(), data: { object: sub("sub_1") } });
    expect((await deliverRaw(payload, "whsec_someone_else")).status).toBe(400);
    const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload }));
    expect(res.status).toBe(400);
    expect(db.data.subscriptions ?? []).toHaveLength(0);
  });

  it("trial → converted to Basic → payment failed → recovered → canceled at period end → ended, audited at each step", async () => {
    await call(checkoutRoute, "POST", "/api/v1/billing/checkout", { ...AGREE, plan: "basic" });
    const trialEnd = now() + 14 * DAY;
    subs.sub_1 = sub("sub_1", { status: "trialing", trial_start: now(), trial_end: trialEnd, periodEnd: trialEnd });
    expect((await deliver("checkout.session.completed", completed("sub_1"))).body.outcome).toBe("created");
    const row = () => db.data.subscriptions[0];
    const ent = () => db.data.entitlements[0];
    expect(row()).toMatchObject({ plan: "trial", status: "trialing", payer_account_id: LEARNER, processor_customer_id: "cus_learner" });
    expect(ent()).toMatchObject({ tier: "trial", source: "subscription", account_id: LEARNER, valid_until: null });
    expect(db.data.trial_consents).toEqual([expect.objectContaining({ account_id: LEARNER, first_charge_amount_cents: 2000, disclosure_document_version_id: "doc-art-v01" })]);

    const steps: [Partial<Stripe.Subscription>, string, string][] = [
      [{ status: "active", trial_end: trialEnd - 20 * DAY }, "basic", "active"],
      [{ status: "past_due" }, "basic", "past_due"],
      [{ status: "active" }, "basic", "active"],
      [{ status: "active", cancel_at_period_end: true }, "basic", "canceled"],
      [{ status: "canceled", ended_at: now(), canceled_at: now() }, "basic", "ended"],
    ];
    for (const [change, plan, status] of steps) {
      subs.sub_1 = { ...subs.sub_1, ...change } as Stripe.Subscription;
      await deliver(status === "ended" ? "customer.subscription.deleted" : "customer.subscription.updated", subs.sub_1);
      expect(row(), status).toMatchObject({ plan, status });
    }
    expect(ent().valid_until).toEqual(expect.any(String));
    expect(audit("billing.subscription.change").map((e) => e.new_value)).toEqual([
      "trial (trialing)", "basic (active)", "basic (past_due)", "basic (active)", "basic (canceled)", "basic (ended)",
    ]);
    expect(db.data.subscriptions).toHaveLength(1);
  });

  it("applies each event once: a redelivery changes nothing and writes no second audit event", async () => {
    subs.sub_1 = sub("sub_1");
    const payload = JSON.stringify({ id: "evt_once", object: "event", type: "customer.subscription.created", created: now(), data: { object: subs.sub_1 } });
    expect((await deliverRaw(payload)).body.outcome).toBe("created");
    const before = JSON.stringify([db.data.subscriptions, db.data.entitlements, db.data.audit_events.length]);
    expect((await deliverRaw(payload)).body.outcome).toBe("duplicate");
    expect(JSON.stringify([db.data.subscriptions, db.data.entitlements, db.data.audit_events.length])).toBe(before);
    expect(db.data.billing_events).toHaveLength(1);
  });

  it("US only: a checkout with a billing address elsewhere is canceled at once and recorded as Blocked", async () => {
    subs.sub_1 = sub("sub_1", { price: ENV.STRIPE_PRICE_PRO });
    const r = await deliver("checkout.session.completed", completed("sub_1", "CA"));
    expect(r.body.outcome).toBe("refused_outside_us");
    expect(calls.cancel).toEqual(["sub_1"]);
    expect(db.data.subscriptions[0]).toMatchObject({ status: "ended" });
    expect(audit("billing.subscription.change").some((e) => e.result === "blocked")).toBe(true);
  });

  it("an older event never overwrites a newer state", async () => {
    subs.sub_1 = sub("sub_1", { status: "past_due" });
    await deliver("customer.subscription.updated", subs.sub_1);
    const late = JSON.stringify({ id: "evt_old", object: "event", type: "customer.subscription.updated", created: now() - 3600, data: { object: subs.sub_1 } });
    subs.sub_1 = { ...subs.sub_1, status: "active" } as Stripe.Subscription;
    expect((await deliverRaw(late)).body.outcome).toBe("stale");
    expect(db.data.subscriptions[0]).toMatchObject({ status: "past_due" });
  });

  it("a payment failure is audited and access continues while Stripe retries", async () => {
    subs.sub_1 = sub("sub_1", { status: "past_due" });
    await deliver("invoice.payment_failed", { id: "in_1", object: "invoice", amount_due: 2000, parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } } });
    expect(audit("billing.payment_failed")).toHaveLength(1);
    expect((await (await call(billingRoute, "GET", "/api/v1/billing")).json()).tier).toBe("basic");
  });
});

describe("entitlements are read from the database; Pro-only routes refuse Basic and trial", () => {
  const pro = async (role: RoleKey = "learner") => {
    const res = await call(proRoute, "GET", "/api/v1/pro", undefined, role);
    return { status: res.status, body: (await res.json()) as { reason?: string; tier?: string } };
  };

  it("no plan, trial and Basic → 403; Pro → 200", async () => {
    expect(await pro()).toEqual({ status: 403, body: expect.objectContaining({ reason: PRO_REQUIRED }) });
    subs.sub_1 = sub("sub_1", { status: "trialing", trial_end: now() + 14 * DAY });
    await deliver("customer.subscription.created", subs.sub_1);
    expect((await pro()).status).toBe(403);
    subs.sub_1 = { ...subs.sub_1, status: "active", trial_end: null } as Stripe.Subscription;
    await deliver("customer.subscription.updated", subs.sub_1);
    expect((await pro()).status).toBe(403);
    subs.sub_1 = { ...subs.sub_1, items: sub("sub_1", { price: ENV.STRIPE_PRICE_PRO }).items } as Stripe.Subscription;
    await deliver("customer.subscription.updated", subs.sub_1);
    expect(await pro()).toEqual({ status: 200, body: { tier: "pro" } });
  });

  it("a canceled Pro keeps access until the paid-through date, then loses it", async () => {
    subs.sub_1 = sub("sub_1", { price: ENV.STRIPE_PRICE_PRO, cancel_at_period_end: true, periodEnd: now() + 5 * DAY });
    await deliver("customer.subscription.updated", subs.sub_1);
    expect((await pro()).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * DAY * 1000);
    try {
      expect((await pro()).status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the Owner has full access and the Super Admin Pro access from their role; nothing the client sends changes a tier", async () => {
    expect((await pro("owner")).status).toBe(200);
    expect((await pro("superAdmin")).status).toBe(200);
    const res = await call(proRoute, "GET", "/api/v1/pro?tier=pro", undefined, "learner");
    expect(res.status).toBe(403);
  });
});

describe("Account → Billing and the customer portal", () => {
  it("shows the plan, the trial end date and the next charge", async () => {
    const trialEnd = now() + 14 * DAY;
    subs.sub_1 = sub("sub_1", { status: "trialing", trial_end: trialEnd, periodEnd: trialEnd });
    await deliver("customer.subscription.created", subs.sub_1);
    const body = await (await call(billingRoute, "GET", "/api/v1/billing")).json();
    expect(body).toMatchObject({
      configured: true, canSubscribe: true, tier: "trial", trialEligible: false,
      subscription: { plan: "trial", status: "trialing", trialEndsAt: new Date(trialEnd * 1000).toISOString(), nextChargeAt: new Date(trialEnd * 1000).toISOString(), nextChargeCents: 2000 },
      terms: { version: RENEWAL_TERMS_VERSION, body: RENEWAL_TERMS_BODY },
    });
  });

  it("opens the portal for the learner's own customer after a second-factor check, and audits it", async () => {
    expect((await call(portalRoute, "POST", "/api/v1/billing/portal", {})).status).toBe(404);
    db.data.billing_customers = [{ id: "bc1", account_id: LEARNER, processor_customer_id: "cus_learner" }];
    session.verified = false;
    expect((await call(portalRoute, "POST", "/api/v1/billing/portal", {})).status).toBe(403);
    session.verified = true;
    const res = await call(portalRoute, "POST", "/api/v1/billing/portal", {});
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/p/1" });
    expect(calls.portal[0]).toMatchObject({ customer: "cus_learner", configuration: ENV.STRIPE_PORTAL_CONFIG, return_url: "https://ascentra.test/account" });
    expect(audit("billing.portal").at(-1)).toMatchObject({ result: "completed", actor_account_id: LEARNER });
  });
});
