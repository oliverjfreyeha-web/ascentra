/**
 * L5 against real Postgres behind PostgREST: the Mentor allowance add-on through the real routes and the real webhook,
 * with only Stripe (signatures made by Stripe's own library) and the Anthropic SDK stubbed. A Basic learner checks out
 * with the $5 add-on (two consent records), Stripe confirms, the meter shows, the Preview test scale runs it out and the
 * Mentor pauses, the learner raises it to $10 and the Mentor resumes, then removes it and the change waits for the
 * renewal; at the renewal the Mentor needs an allowance again. Every response the pages read goes through its reader.
 */
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { ai } from "../fixtures/anthropic-mock";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
vi.mock("@anthropic-ai/sdk", () => import("../fixtures/anthropic-mock"));
const ENV = {
  STRIPE_SECRET_KEY: "sk_test_l5i", STRIPE_WEBHOOK_SECRET: "whsec_l5i", STRIPE_PRICE_BASIC: "price_l5i_basic", STRIPE_PRICE_PRO: "price_l5i_pro",
  STRIPE_PORTAL_CONFIG: "bpc_l5i", STRIPE_PRICE_MENTOR_5: "price_l5i_m5", STRIPE_PRICE_MENTOR_10: "price_l5i_m10", STRIPE_PRICE_MENTOR_20: "price_l5i_m20",
};
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const fx = vi.hoisted(() => ({ subs: {} as Record<string, Stripe.Subscription>, updates: [] as Record<string, unknown>[], checkouts: [] as Record<string, unknown>[] }));
const CENTS: Record<string, number> = { price_l5i_basic: 2000, price_l5i_pro: 5000, price_l5i_m5: 500, price_l5i_m10: 1000, price_l5i_m20: 2000 };
vi.mock("@/lib/billing-env", async (orig) => ({
  ...(await orig<object>()),
  stripeClient: () => ({
    webhooks: real.webhooks,
    prices: { retrieve: async (id: string) => ({ id, active: true, currency: "usd", unit_amount: CENTS[id], type: "recurring", recurring: { interval: "month", interval_count: 1 } }) },
    customers: { create: async () => ({ id: "cus_l5i" }) },
    checkout: { sessions: { create: async (p: Record<string, unknown>) => { fx.checkouts.push(p); return { id: "cs_l5i", url: "https://checkout.stripe.com/c/cs_l5i" }; } } },
    invoices: { createPreview: async () => ({ amount_due: 167 }) },
    subscriptions: {
      list: async () => ({ data: [] }),
      retrieve: async (id: string) => structuredClone(fx.subs[id]),
      update: async (id: string, p: { items: { id?: string; price?: string; deleted?: boolean }[] }) => {
        fx.updates.push(p as Record<string, unknown>);
        const s = fx.subs[id];
        const plan = s.items.data[0];
        let data = [...s.items.data];
        for (const i of p.items) {
          if (i.deleted) data = data.filter((d) => d.id !== i.id);
          else if (i.id) data = data.map((d) => (d.id === i.id ? ({ ...d, price: { id: i.price } } as Stripe.SubscriptionItem) : d));
          else data.push({ ...plan, id: `si_${data.length + 10}`, price: { id: i.price } } as Stripe.SubscriptionItem);
        }
        fx.subs[id] = { ...s, items: { ...s.items, data } } as Stripe.Subscription;
        return structuredClone(fx.subs[id]);
      },
    },
  }),
}));

import * as checkoutRoute from "@/app/api/v1/billing/checkout/route";
import * as billingRoute from "@/app/api/v1/billing/route";
import * as addonRoute from "@/app/api/v1/billing/mentor-addon/route";
import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import * as mentorRoute from "@/app/api/v1/mentor/route";
import * as threadsRoute from "@/app/api/v1/mentor/threads/route";
import { MENTOR_ALLOWANCE_TERMS_VERSION } from "@/lib/mentor-allowance-terms";
import { RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";
import { addonChangeFrom, addonQuoteFrom, mentorAddonFrom } from "@/app/billing-api";
import { mentorReplyFrom, mentorThreadsFrom } from "@/app/mentor-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
let lessonId = "";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const usage = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

beforeAll(async () => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("AI_DAILY_CAP_USD", "");
  // The Preview-only test setting: each message counts 500× its real cost.
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("MENTOR_TEST_PRICE_SCALE", "500");
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  ai.reset();
  ai.parse = async (p) => {
    const sys = typeof p.system === "string" ? p.system : (p.system as { text: string }[]).map((b) => b.text).join("\n");
    if (sys.startsWith("You screen text")) return { stop_reason: "end_turn", usage, parsed_output: { category: "none", gradedWork: false, onTopic: true, asksPersonalData: false } };
    return { stop_reason: "end_turn", usage, parsed_output: { kind: "answer", text: "Reply within five minutes [P1].", passages: [1] } };
  };
  const academy = (await q("insert into public.academies (slug, name) values ('mkt', 'Lead response') returning id")).rows[0].id;
  const course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
  const mod = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Speed') returning id", [course])).rows[0].id;
  lessonId = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Why minutes matter') returning id", [mod])).rows[0].id;
  const src = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
    values ('Speed to lead study', 'web', 'https://example.org/speed', 'approved', $1, now()) returning id`, [ROLE_ID.reviewer])).rows[0].id as string;
  const body = { summary: "", sections: [{ heading: "Speed", paragraphs: [{ text: "Reply to new leads within five minutes.", refs: [1] }] }], takeaways: [] };
  const citations = [{ ref: 1, sourceId: src, title: "Speed to lead study", url: "https://example.org/speed", license: "web_summarize_only", lastChecked: "2026-09-01" }];
  const v = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, last_verified_on, created_by_account_id)
    values ($1, $2, 1, 'Why minutes matter', $3, $4, '2026-09-01', $5) returning id`, [lessonId, course, JSON.stringify(body), JSON.stringify(citations), ROLE_ID.owner])).rows[0].id;
  await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
  await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2 where id = $1", [v, ROLE_ID.reviewer]);
  await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
}, 60_000);
afterAll(() => stack?.stop());

async function call(mod: Record<string, unknown>, method: string, url: string, body?: unknown, role: RoleKey = "learner") {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
let seq = 0;
async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_l5i_${++seq}`, object: "event", type, created: Math.floor(Date.now() / 1000) + seq, data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  const res = await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
  return { status: res.status, body: await res.json() };
}
const stripeSub = (start: number, end: number, addonPrice: string | null): Stripe.Subscription => ({
  id: "sub_l5i", object: "subscription", customer: "cus_l5i", status: "active", start_date: NOW - DAY, cancel_at_period_end: false, cancel_at: null,
  canceled_at: null, ended_at: null, trial_start: null, trial_end: null, metadata: { account_id: ROLE_ID.learner },
  items: { object: "list", data: [
    { id: "si_plan", price: { id: ENV.STRIPE_PRICE_BASIC }, current_period_start: start, current_period_end: end },
    ...(addonPrice ? [{ id: "si_addon", price: { id: addonPrice }, current_period_start: start, current_period_end: end }] : []),
  ] },
}) as unknown as Stripe.Subscription;
const ask = () => call(mentorRoute, "POST", "/api/v1/mentor", { lessonId, message: "How fast should I reply?" });
const billing = async () => mentorAddonFrom((await call(billingRoute, "GET", "/api/v1/billing")).body)!;
async function change(amountCents: number) {
  const quote = addonQuoteFrom((await call(addonRoute, "POST", "/api/v1/billing/mentor-addon", { amountCents })).body)!;
  const r = await call(addonRoute, "POST", "/api/v1/billing/mentor-addon", {
    amountCents, agreed: true, termsVersion: MENTOR_ALLOWANCE_TERMS_VERSION, confirm: true, expectedChargeCents: quote.chargeTodayCents,
  });
  return { quote, done: addonChangeFrom(r.body), status: r.status };
}

describe("L5 on the real database", () => {
  it("checkout with the $5 add-on stores two consent records (plan and add-on), and adds it as a second item", async () => {
    const r = await call(checkoutRoute, "POST", "/api/v1/billing/checkout", {
      plan: "basic", agreed: true, termsVersion: RENEWAL_TERMS_VERSION, usResident: true, mentorAddonCents: 500, addonAgreed: true, addonTermsVersion: MENTOR_ALLOWANCE_TERMS_VERSION,
    });
    expect(r.status).toBe(200);
    expect(fx.checkouts[0].line_items).toEqual([{ price: ENV.STRIPE_PRICE_BASIC, quantity: 1 }, { price: ENV.STRIPE_PRICE_MENTOR_5, quantity: 1 }]);
    const { rows } = await q(`select d.document_key, c.relation from public.consent_records c join public.legal_document_versions d on d.id = c.legal_document_version_id
      where c.account_id = $1 order by d.document_key`, [ROLE_ID.learner]);
    expect(rows).toEqual([{ document_key: "automatic_renewal_terms", relation: "self" }, { document_key: "mentor_allowance_terms", relation: "self" }]);
  });

  it("Stripe confirms; the meter shows $0.00 of $3.50; the Preview test scale runs it out and the Mentor pauses", async () => {
    fx.subs.sub_l5i = stripeSub(NOW - DAY, NOW + 29 * DAY, ENV.STRIPE_PRICE_MENTOR_5);
    expect((await deliver("customer.subscription.created", fx.subs.sub_l5i)).status).toBe(200);
    expect((await billing()).allowance).toMatchObject({ status: "active", addonCents: 500, usableUsd: 3.5, usedUsd: 0, line: expect.stringMatching(/^Mentor allowance: used \$0\.00 of \$3\.50, resets on /) });
    for (let i = 0; i < 3; i++) expect(mentorReplyFrom((await ask()).body)).not.toBeNull();
    const paused = await ask();
    expect(paused.status).toBe(402);
    expect(paused.body.reason).toMatch(/used up \(used \$3\.50 of \$3\.50, resets on/);
    const { rows } = await q("select cost_usd::float as cost, counted_usd::float as counted, price_scale::float as scale from public.mentor_allowance_usage order by created_at");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ cost: 0.0027, counted: 1.35, scale: 500 });
    await expect(q("update public.mentor_allowance_usage set counted_usd = 0")).rejects.toThrow(/kept as recorded/);
  });

  it("raising to $10 charges the prorated difference now and the Mentor resumes", async () => {
    const r = await change(1000);
    expect(r.quote).toMatchObject({ effect: "now", chargeTodayCents: 167, nextChargeCents: 3000 });
    expect(r.done).toEqual({ amountCents: 1000, effect: "now", chargedTodayCents: 167 });
    expect(fx.updates.at(-1)).toMatchObject({ proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" });
    expect((await ask()).status).toBe(200);
    const meter = mentorThreadsFrom((await call(threadsRoute, "GET", `/api/v1/mentor/threads?lessonId=${lessonId}`)).body)!.mentor.allowance;
    expect(meter).toMatchObject({ status: "active", usableUsd: 7, canChange: true });
    const { rows } = await q("select previous_value, new_value, reason, result from public.audit_events where action = 'billing.mentor_addon.change' and actor_account_id = $1", [ROLE_ID.learner]);
    expect(rows).toEqual([{ previous_value: "$5.00/month", new_value: "$10.00/month", reason: "Chosen by the learner (the payer)", result: "completed" }]);
  });

  it("removing it waits for the renewal; at the renewal the new period has none and the Mentor needs an allowance again", async () => {
    const r = await change(0);
    expect(r.done).toMatchObject({ amountCents: 0, effect: "renewal", chargedTodayCents: 0 });
    expect(fx.updates.at(-1)).toMatchObject({ proration_behavior: "none", items: [{ id: "si_addon", deleted: true }] });
    const now = await billing();
    expect(now.allowance).toMatchObject({ status: "active", addonCents: 1000, nextAddonCents: 0 });
    expect((await ask()).status).toBe(200);
    // Stripe renews: the current period is over, and a new one starts, billed without the add-on.
    await q("update public.mentor_allowance_periods set period_end = now() - interval '1 minute' where addon_cents = 1000");
    fx.subs.sub_l5i = stripeSub(NOW - 60, NOW + 30 * DAY, null);
    expect((await deliver("invoice.paid", { id: "in_l5i", object: "invoice", parent: { subscription_details: { subscription: "sub_l5i" } } })).status).toBe(200);
    const { rows } = await q("select addon_cents from public.mentor_allowance_periods order by period_start");
    expect(rows.map((p) => p.addon_cents)).toEqual([1000, 0]);
    expect((await billing()).allowance).toMatchObject({ status: "none", usedUsd: 0 });
    expect(await ask()).toMatchObject({ status: 402, body: { reason: expect.stringMatching(/^The Mentor needs a Mentor allowance/) } });
  });
});
