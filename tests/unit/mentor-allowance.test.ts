/**
 * L5: the Mentor allowance add-on, through the real routes (database faked in memory, Clerk mocked, Stripe faked with
 * webhook signatures made and checked by Stripe's own library, the Anthropic SDK replaced):
 *   - the choices per plan, the reserve, the trial allowance and the Preview-only test scale (pure);
 *   - checkout with the add-on: a second item on the same subscription, its own consent record, its renewal line;
 *   - the webhook keeps the add-on and the period's allowance in step (raise now, lower at renewal, removed, failed
 *     payment), audited with the previous and new value, the reason and the result;
 *   - changing it from Billing: a quote first, then a confirmation carrying the same charge; only the payer;
 *   - the ledger: each Mentor message's real cost; the Mentor pauses when it runs out, and resumes when raised;
 *   - teens: only the Guardian changes it; the Guardian is told at 80% and 100% (a banner when email isn't set up);
 *   - every page reader against the real routes' answers.
 */
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l5", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
const stripe = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/lib/billing-env", async (orig) => ({ ...(await orig<object>()), stripeClient: () => stripe.api }));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));

import * as billingRoute from "@/app/api/v1/billing/route";
import * as checkoutRoute from "@/app/api/v1/billing/checkout/route";
import * as addonRoute from "@/app/api/v1/billing/mentor-addon/route";
import * as alertsRoute from "@/app/api/v1/billing/alerts/route";
import * as guardianRoute from "@/app/api/v1/guardian/route";
import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import * as mentorRoute from "@/app/api/v1/mentor/route";
import * as threadsRoute from "@/app/api/v1/mentor/threads/route";
import { mapSubscription } from "@/lib/billing";
import { RENEWAL_TERMS_BODY, RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";
import {
  ADDON_CHOICES, MENTOR_ALLOWANCE_TERMS_BODY, MENTOR_ALLOWANCE_TERMS_KEY, MENTOR_ALLOWANCE_TERMS_VERSION, addonRenewalLine, isAllowedChoice,
  testPriceScale, usableUsd,
} from "@/lib/mentor-allowance-terms";
import { addonChangeFrom, addonQuoteFrom, mentorAddonFrom, teenAllowancesFrom } from "@/app/billing-api";
import { mentorReplyFrom, mentorThreadsFrom } from "@/app/mentor-api";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_l5_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_l5_test_secret",
  STRIPE_PRICE_BASIC: "price_basic_test",
  STRIPE_PRICE_PRO: "price_pro_test",
  STRIPE_PORTAL_CONFIG: "bpc_test",
  STRIPE_PRICE_MENTOR_5: "price_m5",
  STRIPE_PRICE_MENTOR_10: "price_m10",
  STRIPE_PRICE_MENTOR_20: "price_m20",
};
const ADDON_PRICE: Record<number, string> = { 500: "price_m5", 1000: "price_m10", 2000: "price_m20" };
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const LEARNER = ROLE_ID.learner;
const GUARDIAN = ROLE_ID.guardian;
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const START = now() - 10 * DAY;
const END = now() + 20 * DAY;

type Db = ReturnType<typeof seedFake>;
let db: Db;
let subs: Record<string, Stripe.Subscription>;
let calls: { checkout: Record<string, unknown>[]; updates: { id: string; params: Record<string, unknown>; key?: string }[]; previews: Record<string, unknown>[] };
let previewAmount: number;
let declineNext: boolean;
let lessonId = "";
let itemSeq = 0;

const recurring = (cents: number) => ({ active: true, currency: "usd", unit_amount: cents, type: "recurring", recurring: { interval: "month", interval_count: 1 } });
const PRICES: Record<string, ReturnType<typeof recurring>> = {
  [ENV.STRIPE_PRICE_BASIC]: recurring(2000), [ENV.STRIPE_PRICE_PRO]: recurring(5000), price_m5: recurring(500), price_m10: recurring(1000), price_m20: recurring(2000),
};

const item = (price: string, start = START, end = END) => ({ id: `si_${++itemSeq}`, price: { id: price }, current_period_start: start, current_period_end: end });
function sub(id: string, o: Partial<Stripe.Subscription> & { plan?: string; addon?: number; start?: number; end?: number; customer?: string; account?: string } = {}): Stripe.Subscription {
  const { plan = ENV.STRIPE_PRICE_BASIC, addon = 0, start = START, end = END, customer = "cus_learner", account = LEARNER, ...rest } = o;
  return {
    id, object: "subscription", customer, status: "active", start_date: START, cancel_at_period_end: false, cancel_at: null, canceled_at: null,
    ended_at: null, trial_start: null, trial_end: null, metadata: { account_id: account },
    items: { object: "list", data: [item(plan, start, end), ...(addon ? [item(ADDON_PRICE[addon], start, end)] : [])] },
    ...rest,
  } as unknown as Stripe.Subscription;
}

function fakeStripe() {
  return {
    webhooks: real.webhooks,
    prices: { retrieve: vi.fn(async (id: string) => ({ id, ...PRICES[id] })) },
    customers: { create: vi.fn(async () => ({ id: "cus_learner" })) },
    subscriptions: {
      list: vi.fn(async () => ({ data: Object.values(subs) })),
      retrieve: vi.fn(async (id: string) => structuredClone(subs[id])),
      update: vi.fn(async (id: string, params: { items: { id?: string; price?: string; deleted?: boolean }[]; payment_behavior?: string }, opts?: { idempotencyKey?: string }) => {
        calls.updates.push({ id, params: params as Record<string, unknown>, key: opts?.idempotencyKey });
        if (declineNext && params.payment_behavior === "error_if_incomplete") {
          declineNext = false;
          throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        }
        const s = subs[id];
        let data = [...s.items.data];
        const plan = data[0] as unknown as { current_period_start: number; current_period_end: number };
        for (const p of params.items) {
          if (p.deleted) data = data.filter((i) => i.id !== p.id);
          else if (p.id) data = data.map((i) => (i.id === p.id ? ({ ...i, price: { id: p.price } } as unknown as Stripe.SubscriptionItem) : i));
          else data.push(item(p.price!, plan.current_period_start, plan.current_period_end) as unknown as Stripe.SubscriptionItem);
        }
        subs[id] = { ...s, items: { ...s.items, data } } as Stripe.Subscription;
        return structuredClone(subs[id]);
      }),
    },
    invoices: { createPreview: vi.fn(async (p: Record<string, unknown>) => { calls.previews.push(p); return { amount_due: previewAmount }; }) },
    checkout: { sessions: { create: vi.fn(async (p: Record<string, unknown>) => { calls.checkout.push(p); return { id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }; }) } },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.com/p/1" })) } },
  };
}

async function lesson() {
  const a = (await db.client.from("academies").insert({ slug: "leads", name: "Lead response" }).select("id").single()).data as { id: string };
  const c = (await db.client.from("courses").insert({ academy_id: a.id, version: 1, status: "published" }).select("id").single()).data as { id: string };
  const m = (await db.client.from("modules").insert({ course_id: c.id, position: 1, code: "m1", title: "Basics" }).select("id").single()).data as { id: string };
  const l = (await db.client.from("lessons").insert({ module_id: m.id, position: 1, title: "Lead response basics" }).select("id").single()).data as { id: string };
  await db.client.from("lesson_versions").insert({
    lesson_id: l.id, course_id: c.id, version: 1, status: "published", title: "Lead response basics", published_at: "2026-09-01",
    body: { summary: "", sections: [{ heading: "H", paragraphs: [{ text: "Reply to new leads within five minutes.", refs: [1] }] }], takeaways: [] },
    citations: [{ ref: 1, sourceId: "s-leads", title: "Lead study", url: "https://example.org/leads", license: "open", lastChecked: "2026-09-01" }],
  });
  return l.id;
}

const usage = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
beforeEach(async () => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  vi.stubEnv("MENTOR_TEST_PRICE_SCALE", "");
  vi.stubEnv("VERCEL_ENV", "");
  db = seedFake();
  fake.db = db;
  db.data.legal_document_versions = [
    { id: "doc-art-v01", document_key: RENEWAL_TERMS_KEY, version: RENEWAL_TERMS_VERSION, status: "published", body: RENEWAL_TERMS_BODY },
    { id: "doc-mat-v01", document_key: MENTOR_ALLOWANCE_TERMS_KEY, version: MENTOR_ALLOWANCE_TERMS_VERSION, status: "published", body: MENTOR_ALLOWANCE_TERMS_BODY },
  ];
  db.data.sources = [{ id: "s-leads", title: "Lead study", url: "https://example.org/leads", status: "approved", academy_id: null, license_class: "open" }];
  subs = {};
  calls = { checkout: [], updates: [], previews: [] };
  previewAmount = 333;
  declineNext = false;
  stripe.api = fakeStripe();
  lessonId = await lesson();
  ai.reset();
  ai.parse = async (p) => {
    const sys = typeof p.system === "string" ? p.system : (p.system as { text: string }[]).map((b) => b.text).join("\n");
    if (sys.startsWith("You screen text")) return { stop_reason: "end_turn", usage, parsed_output: { category: "none", gradedWork: false, onTopic: true, asksPersonalData: false } };
    return { stop_reason: "end_turn", usage, parsed_output: { kind: "answer", text: "Reply within five minutes [P1].", passages: [1] } };
  };
});

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey = "learner", body?: unknown) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
let seq = 0;
async function deliver(type: string, object: unknown, created = now()) {
  const payload = JSON.stringify({ id: `evt_${++seq}`, object: "event", type, created, data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return { status: res.status, body: (await res.json()) as { outcome?: string } };
}
/** A live Stripe subscription, applied through the webhook. */
async function live(o: Parameters<typeof sub>[1] = {}, id = "sub_1") {
  subs[id] = sub(id, o);
  db.data.billing_customers = [...(db.data.billing_customers ?? []), { account_id: o.account ?? LEARNER, processor_customer_id: o.customer ?? "cus_learner" }];
  expect((await deliver("customer.subscription.created", subs[id])).status).toBe(200);
  return db.data.subscriptions.find((s) => s.processor_subscription_id === id)!;
}
const ask = (message = "How fast should I reply?", role: RoleKey = "learner") => call(mentorRoute, "POST", "/api/v1/mentor", role, { lessonId, message });
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);
const periods = () => db.data.mentor_allowance_periods ?? [];
const quote = (amountCents: number, role: RoleKey = "learner", extra: Record<string, unknown> = {}) =>
  call(addonRoute, "POST", "/api/v1/billing/mentor-addon", role, { amountCents, ...extra });
async function change(amountCents: number, role: RoleKey = "learner", extra: Record<string, unknown> = {}) {
  const q = addonQuoteFrom((await quote(amountCents, role, extra)).body)!;
  expect(q).not.toBeNull();
  return call(addonRoute, "POST", "/api/v1/billing/mentor-addon", role, {
    amountCents, agreed: true, termsVersion: MENTOR_ALLOWANCE_TERMS_VERSION, confirm: true, expectedChargeCents: q.chargeTodayCents, ...extra,
  });
}
function teen() {
  db.data.accounts.find((a) => a.id === LEARNER)!.is_minor = true;
  db.data.guardian_relationships = [{ id: "gr-1", teen_account_id: LEARNER, guardian_account_id: GUARDIAN, verification_status: "verified", withdrawn_at: null }];
}

describe("the rules (pure)", () => {
  it("offers Basic none/$5/$10 and Pro none/$10/$20, nothing else; the trial has Basic's choices", () => {
    expect(ADDON_CHOICES).toEqual({ basic: [0, 500, 1000], pro: [0, 1000, 2000] });
    expect([isAllowedChoice("basic", 500), isAllowedChoice("basic", 2000), isAllowedChoice("pro", 500), isAllowedChoice("pro", 2000), isAllowedChoice("trial", 1000), isAllowedChoice("pro", "1000")])
      .toEqual([true, false, false, true, true, false]);
  });

  it("the usable allowance is the add-on minus the 30% reserve; the trial gets $1; a plan change caps it at the plan's top", () => {
    expect(usableUsd({ addonCents: 500, trial: false, plan: "basic" })).toBe(3.5);
    expect(usableUsd({ addonCents: 2000, trial: false, plan: "pro" })).toBe(14);
    expect(usableUsd({ addonCents: 2000, trial: false, plan: "basic" })).toBe(7);
    expect(usableUsd({ addonCents: 500, trial: true, plan: "trial" })).toBe(1);
    expect(usableUsd({ addonCents: 0, trial: true, plan: "trial" })).toBe(0);
  });

  it("the test price scale works only on a Vercel Preview; it can't be turned on in Production or anywhere else", () => {
    expect(testPriceScale({ VERCEL_ENV: "preview", MENTOR_TEST_PRICE_SCALE: "200" })).toBe(200);
    expect(testPriceScale({ VERCEL_ENV: "production", MENTOR_TEST_PRICE_SCALE: "200" })).toBe(1);
    expect(testPriceScale({ VERCEL_ENV: "development", MENTOR_TEST_PRICE_SCALE: "200" })).toBe(1);
    expect(testPriceScale({ MENTOR_TEST_PRICE_SCALE: "200" })).toBe(1);
    expect(testPriceScale({ VERCEL_ENV: "preview", MENTOR_TEST_PRICE_SCALE: "0.1" })).toBe(1);
  });

  it("the plan is the Basic/Pro item and the add-on the Mentor item; anything else is refused", () => {
    const env = { STRIPE_PRICE_BASIC: ENV.STRIPE_PRICE_BASIC, STRIPE_PRICE_PRO: ENV.STRIPE_PRICE_PRO };
    const of = (id: string | null | undefined) => (({ price_m5: 500, price_m10: 1000, price_m20: 2000 }) as Record<string, 500 | 1000 | 2000>)[id ?? ""] ?? null;
    const s = sub("sub_x", { addon: 500 });
    s.items.data.reverse();
    const m = mapSubscription(s, env, of);
    expect("row" in m && m.row).toMatchObject({ plan: "basic", processor_price_id: ENV.STRIPE_PRICE_BASIC, mentor_addon_cents: 500, mentor_addon_price_id: "price_m5" });
    const stray = sub("sub_y");
    stray.items.data.push(item("price_other") as unknown as Stripe.SubscriptionItem);
    expect(mapSubscription(stray, env, of)).toMatchObject({ error: expect.stringContaining("price_other") });
    expect(mapSubscription(sub("sub_z", { addon: 500 }), env)).toMatchObject({ error: expect.stringContaining("price_m5") });
  });

  it("the renewal line names the amount and that it renews", () => {
    expect(addonRenewalLine(1000)).toBe("Mentor allowance: $10.00 per month, renewing automatically with my plan until I remove it.");
    expect(MENTOR_ALLOWANCE_TERMS_BODY).not.toMatch(/attorney|lawyer|approved by counsel/i);
  });
});

describe("checkout with the add-on", () => {
  const AGREE = { agreed: true, termsVersion: RENEWAL_TERMS_VERSION, usResident: true };

  it("adds it as a second item on the same subscription, with its own consent record and renewal line", async () => {
    const r = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", "learner", { ...AGREE, plan: "basic", mentorAddonCents: 500, addonAgreed: true, addonTermsVersion: MENTOR_ALLOWANCE_TERMS_VERSION });
    expect(r.status).toBe(200);
    const p = calls.checkout[0] as { line_items: unknown; custom_text: { submit: { message: string } }; subscription_data: { metadata: Record<string, string>; trial_period_days?: number } };
    expect(p.line_items).toEqual([{ price: ENV.STRIPE_PRICE_BASIC, quantity: 1 }, { price: "price_m5", quantity: 1 }]);
    expect(p.custom_text.submit.message).toMatch(/after my free trial ends .*\$20\.00 every month.* Mentor allowance: \$5\.00 per month, renewing automatically with my plan until I remove it\. It is first charged when the trial ends\./);
    expect(p.subscription_data).toMatchObject({ trial_period_days: 14, metadata: { mentor_addon_cents: "500" } });
    expect(db.data.consent_records.map((c) => c.legal_document_version_id).sort()).toEqual(["doc-art-v01", "doc-mat-v01"]);
    expect(p.subscription_data.metadata.mentor_addon_consent_record_id).toBe(db.data.consent_records.find((c) => c.legal_document_version_id === "doc-mat-v01")!.id);
  });

  it("refuses an amount the plan doesn't offer, or the add-on without its own agreement; a plan alone still works without the add-on prices", async () => {
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", "learner", { ...AGREE, plan: "basic", mentorAddonCents: 2000, addonAgreed: true, addonTermsVersion: "v0.1" })).status).toBe(400);
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", "learner", { ...AGREE, plan: "pro", mentorAddonCents: 500, addonAgreed: true, addonTermsVersion: "v0.1" })).status).toBe(400);
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", "learner", { ...AGREE, plan: "pro", mentorAddonCents: 1000 })).status).toBe(400);
    vi.stubEnv("STRIPE_PRICE_MENTOR_20", "");
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", "learner", { ...AGREE, plan: "pro", mentorAddonCents: 1000, addonAgreed: true, addonTermsVersion: "v0.1" })).status).toBe(503);
    expect(calls.checkout).toHaveLength(0);
    expect((await call(checkoutRoute, "POST", "/api/v1/billing/checkout", "learner", { ...AGREE, plan: "pro" })).status).toBe(200);
    expect(calls.checkout[0].line_items).toEqual([{ price: ENV.STRIPE_PRICE_PRO, quantity: 1 }]);
  });
});

describe("the webhook keeps the add-on in step", () => {
  it("records the add-on and this period's allowance, and audits the change with the previous and new value, reason and result", async () => {
    const row = await live({ addon: 500 });
    expect(row).toMatchObject({ mentor_addon_cents: 500, mentor_addon_price_id: "price_m5" });
    expect(periods()).toEqual([expect.objectContaining({ subscription_id: row.id, account_id: LEARNER, addon_cents: 500, trial: false })]);
    expect(audit("billing.mentor_addon.change")).toEqual([expect.objectContaining({ previous_value: "none", new_value: "$5.00/month", reason: "Kept in step with Stripe", result: "completed" })]);
  });

  it("a raise counts at once; a lower amount or a removal only from the next period; the next period starts from zero", async () => {
    await live({ addon: 500 });
    subs.sub_1 = sub("sub_1", { addon: 1000 });
    await deliver("customer.subscription.updated", subs.sub_1);
    expect(periods()[0].addon_cents).toBe(1000);
    subs.sub_1 = sub("sub_1", { addon: 0 });
    await deliver("customer.subscription.updated", subs.sub_1);
    expect(db.data.subscriptions[0].mentor_addon_cents).toBe(0);
    expect(periods()[0].addon_cents).toBe(1000);
    expect(audit("billing.mentor_addon.change").map((e) => [e.previous_value, e.new_value])).toEqual([["none", "$5.00/month"], ["$5.00/month", "$10.00/month"], ["$10.00/month", "none"]]);
    // Renewal: a new period with the amount Stripe bills now (none).
    subs.sub_1 = sub("sub_1", { addon: 0, start: END, end: END + 30 * DAY });
    await deliver("customer.subscription.updated", subs.sub_1);
    expect(periods().map((p) => p.addon_cents)).toEqual([1000, 0]);
  });

  it("a failed payment follows the existing rules: past due keeps access (and the allowance) while Stripe retries", async () => {
    await live({ addon: 500 });
    subs.sub_1 = { ...sub("sub_1", { addon: 500 }), status: "past_due" } as Stripe.Subscription;
    await deliver("invoice.payment_failed", { id: "in_1", object: "invoice", amount_due: 2500, parent: { subscription_details: { subscription: "sub_1" } } });
    expect(db.data.subscriptions[0].status).toBe("past_due");
    expect(audit("billing.payment_failed")).toHaveLength(1);
    expect((await ask()).status).toBe(200);
  });
});

describe("changing it from Billing", () => {
  it("quotes first (nothing changes, nothing is recorded), then raises at once with the prorated charge and the terms agreed", async () => {
    await live({ addon: 500 });
    const q = await quote(1000);
    expect(addonQuoteFrom(q.body)).toMatchObject({ amountCents: 1000, previousCents: 500, effect: "now", chargeTodayCents: 333, nextChargeCents: 3000 });
    expect(calls.updates).toHaveLength(0);
    expect(db.data.consent_records ?? []).toHaveLength(0);
    // Confirming needs the terms and the same charge as quoted.
    expect((await call(addonRoute, "POST", "/api/v1/billing/mentor-addon", "learner", { amountCents: 1000, confirm: true, expectedChargeCents: 333 })).status).toBe(400);
    expect((await call(addonRoute, "POST", "/api/v1/billing/mentor-addon", "learner", { amountCents: 1000, agreed: true, termsVersion: "v0.1", confirm: true, expectedChargeCents: 100 })).body.reason).toMatch(/has changed to \$3\.33/);
    expect(calls.updates).toHaveLength(0);
    const r = await change(1000);
    expect(addonChangeFrom(r.body)).toEqual({ amountCents: 1000, effect: "now", chargedTodayCents: 333 });
    expect(calls.updates[0].params).toMatchObject({ proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete", items: [{ price: "price_m10" }] });
    expect(db.data.consent_records).toEqual([expect.objectContaining({ account_id: LEARNER, actor_account_id: LEARNER, relation: "self", legal_document_version_id: "doc-mat-v01" })]);
    expect(periods()[0].addon_cents).toBe(1000);
    expect(audit("billing.mentor_addon.change").at(-1)).toMatchObject({
      actor_account_id: LEARNER, previous_value: "$5.00/month", new_value: "$10.00/month", reason: "Chosen by the learner (the payer)", result: "completed",
    });
  });

  it("a lower amount or a removal applies at renewal, with no charge and no proration; this period keeps its allowance", async () => {
    await live({ addon: 1000 });
    expect(addonQuoteFrom((await quote(0)).body)).toMatchObject({ effect: "renewal", chargeTodayCents: 0, nextChargeCents: 2000 });
    const r = await change(0);
    expect(addonChangeFrom(r.body)).toMatchObject({ amountCents: 0, effect: "renewal", chargedTodayCents: 0 });
    expect(calls.updates[0].params).toMatchObject({ proration_behavior: "none", items: [{ deleted: true }] });
    expect(calls.previews).toHaveLength(0);
    expect(db.data.subscriptions[0].mentor_addon_cents).toBe(0);
    expect(periods()[0].addon_cents).toBe(1000);
    // Raising back to what this period paid costs nothing; raising past it charges only the difference from there.
    expect(addonQuoteFrom((await quote(500)).body)).toMatchObject({ effect: "renewal", chargeTodayCents: 0 });
    expect((await quote(0)).status).toBe(409);
  });

  it("refuses an amount the plan doesn't offer, a failed payment, and anyone but the payer", async () => {
    await live({ addon: 500 });
    expect((await quote(2000)).body.reason).toBe("Choose none, $5.00 per month or $10.00 per month for the Basic plan.");
    expect((await quote(500)).status).toBe(409);
    expect((await quote(1000, "support")).status).toBe(403);
    declineNext = true;
    const r = await change(1000);
    expect(r).toMatchObject({ status: 402, body: { reason: expect.stringMatching(/didn't go through, so nothing changed/) } });
    expect(db.data.subscriptions[0].mentor_addon_cents).toBe(500);
    expect(periods()[0].addon_cents).toBe(500);
    expect(audit("billing.mentor_addon.change").at(-1)).toMatchObject({ result: "blocked" });
  });

  it("during the free trial nothing is charged now: the add-on starts at conversion, with the small trial allowance meanwhile", async () => {
    await live({ status: "trialing", trial_end: END });
    expect(addonQuoteFrom((await quote(500)).body)).toMatchObject({ effect: "conversion", chargeTodayCents: 0 });
    await change(500);
    expect(calls.updates[0].params).toMatchObject({ proration_behavior: "none" });
    const info = mentorAddonFrom((await call(billingRoute, "GET", "/api/v1/billing")).body)!;
    expect(info.allowance).toMatchObject({ status: "active", usableUsd: 1, trial: true, addonCents: 500 });
  });
});

describe("the ledger and the pause", () => {
  it("without an add-on the Mentor is paused with a plain message; staff are exempt", async () => {
    await live();
    expect(await ask()).toMatchObject({ status: 402, body: { reason: expect.stringMatching(/^The Mentor needs a Mentor allowance.*Plan and billing/) } });
    expect((await ask("How fast?", "owner")).status).toBe(200);
  });

  it("records each message's real cost; pauses when the allowance runs out (Preview test scale); resumes when raised", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("MENTOR_TEST_PRICE_SCALE", "500");
    await live({ addon: 500 });
    // Three Haiku calls of 500 in / 80 out = $0.0027 real; ×500 = $1.35 counted against $3.50 usable.
    for (let i = 0; i < 3; i++) expect((await ask()).status).toBe(200);
    expect(db.data.mentor_allowance_usage).toHaveLength(3);
    expect(db.data.mentor_allowance_usage[0]).toMatchObject({ cost_usd: 0.0027, counted_usd: 1.35, price_scale: 500 });
    const paused = await ask();
    expect(paused).toMatchObject({ status: 402, body: { reason: expect.stringMatching(/^Your Mentor allowance for this period is used up \(used \$3\.50 of \$3\.50, resets on .+\)\. The Mentor is paused until then\. You can add or raise it in Plan and billing/) } });
    const meter = mentorThreadsFrom((await call(threadsRoute, "GET", `/api/v1/mentor/threads?lessonId=${lessonId}`)).body)!.mentor.allowance;
    expect(meter).toMatchObject({ status: "used_up", usableUsd: 3.5, canChange: true, line: expect.stringMatching(/^Mentor allowance: used \$3\.50 of \$3\.50, resets on /) });
    await change(1000);
    const resumed = mentorReplyFrom((await ask()).body)!;
    expect(resumed.mentor.allowance).toMatchObject({ status: "active", usableUsd: 7, usedUsd: 5.4 });
  });

  it("in Production the test setting does nothing: the real cost is what counts", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MENTOR_TEST_PRICE_SCALE", "500");
    await live({ addon: 500 });
    await ask();
    expect(db.data.mentor_allowance_usage[0]).toMatchObject({ cost_usd: 0.0027, counted_usd: 0.0027, price_scale: 1 });
  });

  it("the Billing panel's answer carries the meter, read through its reader", async () => {
    await live({ addon: 500 });
    await ask();
    const info = mentorAddonFrom((await call(billingRoute, "GET", "/api/v1/billing")).body)!;
    expect(info).toMatchObject({ available: true, canChange: true, reservePercent: 30, choices: { basic: [0, 500, 1000], pro: [0, 1000, 2000] }, terms: { version: "v0.1" } });
    expect(info.allowance).toMatchObject({ status: "active", addonCents: 500, usableUsd: 3.5, usedUsd: 0.0027, line: expect.stringMatching(/^Mentor allowance: used \$0\.00 of \$3\.50, resets on /) });
    expect((await call(billingRoute, "GET", "/api/v1/billing")).body.subscription).toMatchObject({ nextChargeCents: 2500 });
  });
});

describe("teens", () => {
  beforeEach(() => teen());

  it("only the Guardian chooses, changes or removes it, with a separate consent record; the teen sees the meter only", async () => {
    await live({ addon: 500, customer: "cus_guardian", account: GUARDIAN, metadata: { account_id: GUARDIAN, beneficiary_account_id: LEARNER } } as never);
    expect(db.data.subscriptions[0]).toMatchObject({ payer_account_id: GUARDIAN, beneficiary_account_id: LEARNER });
    expect(await quote(1000)).toMatchObject({ status: 403, body: { reason: "Only your Guardian can choose, change or remove your Mentor allowance." } });
    const teenView = mentorAddonFrom((await call(billingRoute, "GET", "/api/v1/billing")).body)!;
    expect(teenView).toMatchObject({ canChange: false, allowance: { status: "active", usableUsd: 3.5 } });
    expect((await call(threadsRoute, "GET", `/api/v1/mentor/threads?lessonId=${lessonId}`)).body.mentor).toMatchObject({ allowance: { canChange: false } });
    const r = await change(1000, "guardian", { teenAccountId: LEARNER });
    expect(r.status).toBe(200);
    expect(db.data.consent_records).toEqual([expect.objectContaining({ account_id: LEARNER, actor_account_id: GUARDIAN, relation: "guardian_for_teen", legal_document_version_id: "doc-mat-v01" })]);
    expect(audit("billing.mentor_addon.change").at(-1)).toMatchObject({ actor_account_id: GUARDIAN, reason: expect.stringMatching(/Guardian \(the payer\)$/) });
    const teens = teenAllowancesFrom((await call(guardianRoute, "GET", "/api/v1/guardian", "guardian")).body)!;
    expect(teens[LEARNER]).toMatchObject({ addonCents: 1000, usableUsd: 7, choices: [0, 500, 1000] });
  });

  it("the Guardian is told at 80% and at 100%; without email the notice is recorded as skipped and shown as a banner", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("MENTOR_TEST_PRICE_SCALE", "500");
    await live({ addon: 500, customer: "cus_guardian", account: GUARDIAN, metadata: { account_id: GUARDIAN, beneficiary_account_id: LEARNER } } as never);
    await ask(); await ask();
    expect(db.data.notices ?? []).toHaveLength(0);
    await ask(); // $4.05 counted of $3.50: past 80% and 100%
    expect(db.data.notices.map((n) => [n.kind, n.account_id, n.about_account_id, n.status]).sort()).toEqual([
      ["mentor_allowance_100", GUARDIAN, LEARNER, "skipped"], ["mentor_allowance_80", GUARDIAN, LEARNER, "skipped"],
    ]);
    expect(JSON.stringify(db.data.notices)).not.toMatch(/How fast/);
    const alerts = (await call(alertsRoute, "GET", "/api/v1/billing/alerts", "guardian")).body.alerts as { kind: string; message: string; href: string }[];
    expect(alerts).toEqual([expect.objectContaining({ kind: "mentor_allowance", href: "/guardian", message: expect.stringMatching(/used all of this period's Mentor allowance/) })]);
    expect(await ask()).toMatchObject({ status: 402, body: { reason: expect.stringMatching(/Only your Guardian can add or raise it/) } });
  });
});
