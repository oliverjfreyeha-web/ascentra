/**
 * B3: Guardian verification and teen activation, end to end through the real routes (database faked in memory,
 * Clerk mocked, Stripe faked; webhook signatures made and checked with Stripe's own library):
 *   teen invites → Clerk emails the Guardian → Guardian signs up from the invitation → Stripe Identity verifies an
 *   adult → the Guardian agrees to each teen document → pays as customer of record → the teen is active, with teen
 *   defaults → the Guardian withdraws consent → the teen is paused, nothing deleted, the plan ends at period end.
 */
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { clerkUser } from "../fixtures/clerk-user";
import { deviceCookie, trustedDeviceRow } from "../fixtures/devices";
import { TEEN_DOCUMENTS } from "@/lib/teen-documents";
import { RENEWAL_TERMS_BODY, RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";
import { TEST_ENV } from "../fixtures/env";
import { isoDate, usToday } from "@/lib/age";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const clerk = vi.hoisted(() => ({
  userId: null as string | null, users: {} as Record<string, unknown>, invites: [] as Record<string, unknown>[], revoked: [] as string[],
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: !!clerk.userId, userId: clerk.userId, sessionId: `sess_${clerk.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({
    invitations: {
      createInvitation: vi.fn(async (p: Record<string, unknown>) => { clerk.invites.push(p); return { id: `inv_${clerk.invites.length}` }; }),
      revokeInvitation: vi.fn(async (id: string) => { clerk.revoked.push(id); return {}; }),
    },
    users: { getUser: async (id: string) => ({ raw: clerk.users[id] }), deleteUser: async () => ({}) },
  })),
  reverificationErrorResponse: () => Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));
const stripe = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/lib/billing-env", async (orig) => ({ ...(await orig<object>()), stripeClient: () => stripe.api }));

import * as registrationRoute from "@/app/api/registration/route";
import * as teenInviteRoute from "@/app/api/registration/guardian/route";
import * as guardianAccountRoute from "@/app/api/registration/guardian-account/route";
import * as overviewRoute from "@/app/api/v1/guardian/route";
import * as identityRoute from "@/app/api/v1/guardian/identity/route";
import * as consentRoute from "@/app/api/v1/guardian/teens/[accountId]/consent/route";
import * as withdrawRoute from "@/app/api/v1/guardian/teens/[accountId]/withdraw/route";
import * as checkoutRoute from "@/app/api/v1/billing/checkout/route";
import * as webhookRoute from "@/app/api/webhooks/stripe/route";
import { getAccount } from "@/lib/auth";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_b3_not_a_real_key", STRIPE_WEBHOOK_SECRET: "whsec_b3_test_secret",
  STRIPE_PRICE_BASIC: "price_basic_test", STRIPE_PRICE_PRO: "price_pro_test", STRIPE_PORTAL_CONFIG: "bpc_test",
};
const real = new Stripe(ENV.STRIPE_SECRET_KEY);
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
type Db = ReturnType<typeof seedFake>;
let db: Db;
let identity: Record<string, { status: string; dob?: { day: number; month: number; year: number } | null }>;
let subs: Record<string, Stripe.Subscription>;
let calls: { checkout: Record<string, unknown>[]; identity: Record<string, unknown>[]; updates: [string, Record<string, unknown>][] };

function yearsAgo(years: number) {
  const t = usToday();
  return isoDate({ y: t.y - years, m: t.m, d: t.d });
}
const PRICE = { active: true, currency: "usd", type: "recurring", recurring: { interval: "month", interval_count: 1 } };

function fakeStripe() {
  return {
    webhooks: real.webhooks,
    prices: { retrieve: vi.fn(async (id: string) => ({ id, ...PRICE, unit_amount: id === ENV.STRIPE_PRICE_PRO ? 5000 : 2000 })) },
    customers: { create: vi.fn(async () => ({ id: "cus_guardian" })) },
    subscriptions: {
      list: vi.fn(async () => ({ data: Object.values(subs) })),
      retrieve: vi.fn(async (id: string) => subs[id]),
      update: vi.fn(async (id: string, p: Record<string, unknown>) => { calls.updates.push([id, p]); subs[id] = { ...subs[id], ...p } as Stripe.Subscription; return subs[id]; }),
      cancel: vi.fn(),
    },
    checkout: { sessions: { create: vi.fn(async (p: Record<string, unknown>) => { calls.checkout.push(p); return { id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }; }) } },
    identity: {
      verificationSessions: {
        create: vi.fn(async (p: Record<string, unknown>) => {
          calls.identity.push(p);
          const id = `vs_${calls.identity.length}`;
          identity[id] = { status: "requires_input" };
          return { id, url: `https://verify.stripe.com/start/${id}` };
        }),
        retrieve: vi.fn(async (id: string) => ({ id, status: identity[id].status, last_error: null, verified_outputs: { dob: identity[id].dob ?? null } })),
      },
    },
  };
}

beforeEach(() => {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...ENV })) vi.stubEnv(k, v);
  db = seedFake();
  db.data.legal_document_versions = [
    { id: "doc-art", document_key: RENEWAL_TERMS_KEY, version: RENEWAL_TERMS_VERSION, status: "published", body: RENEWAL_TERMS_BODY },
    ...Object.entries(TEEN_DOCUMENTS).map(([k, d]) => ({ id: `doc-${k}`, document_key: k, version: d.version, status: "published", body: d.body })),
  ];
  fake.db = db;
  clerk.userId = null;
  clerk.users = {};
  clerk.invites = [];
  clerk.revoked = [];
  identity = {};
  subs = {};
  calls = { checkout: [], identity: [], updates: [] };
  stripe.api = fakeStripe();
});

// ---------- helpers ----------
function signIn(id: string, email: string, meta?: Record<string, unknown>) {
  const u = clerkUser({ id, email, passwordEnabled: true, twoFactorEnabled: true }) as unknown as Record<string, unknown>;
  if (meta) u.public_metadata = meta;
  clerk.users[id] = u;
  clerk.userId = id;
}
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
async function postP(mod: { POST: (r: Request) => Promise<Response> }, body: unknown) {
  return { ...(await json(await mod.POST(new Request("https://ascentra.test/api/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))) };
}
const accountOf = (clerkId: string) => db.data.accounts.find((a) => a.clerk_user_id === clerkId)!;
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);
const links = () => db.data.guardian_relationships ?? [];

/** An API call as a signed-in account, from its trusted device. */
async function api(mod: Record<string, unknown>, method: string, url: string, clerkId: string, body?: unknown, params: Record<string, string> = {}) {
  clerk.userId = clerkId;
  const id = accountOf(clerkId).id as string;
  if (!db.data.trusted_devices.some((d) => d.account_id === id)) db.data.trusted_devices.push(trustedDeviceRow(id));
  const req = new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(id), "user-agent": "B3" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return json(await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve(params) }));
}
let seq = 0;
async function deliver(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_b3_${++seq}`, object: "event", type, created: now(), data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  return json(await webhookRoute.POST(new Request("https://ascentra.test/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } })));
}

/** A teen who signed up (B2) and invited mom@example.com; then mom signs up from the invitation. */
async function teenAndGuardian(teen = "user_teen", email = "mom@example.com", guardian = "user_mom") {
  signIn(teen, `${teen}@example.com`);
  expect((await postP(registrationRoute, { dateOfBirth: yearsAgo(15), usResident: true })).body.state).toBe("guardian");
  const inv = await postP(teenInviteRoute, { guardianEmail: email });
  const link = links().find((l) => l.teen_account_id === accountOf(teen).id)!;
  if (!db.data.accounts.some((a) => a.email === email)) {
    expect(inv.body).toMatchObject({ state: "guardian", guardianEmail: email, progress: "invited", emailSent: true });
    expect(clerk.invites.at(-1)).toMatchObject({ emailAddress: email, publicMetadata: { ascentra_guardian_invite_id: link.id }, redirectUrl: "https://ascentra.test/sign-up" });
    signIn(guardian, email, { ascentra_guardian_invite_id: link.id });
    expect((await postP(guardianAccountRoute, { adult: true, usResident: true, relationship: "parent" })).body).toEqual({ state: "ready", home: "/guardian" });
  }
  return { teenId: accountOf(teen).id as string, guardianId: db.data.accounts.find((a) => a.email === email)!.id as string, linkId: link.id as string };
}
async function verifyIdentity(guardian = "user_mom", dob = { day: 1, month: 1, year: 1980 }) {
  const started = await api(identityRoute, "POST", "/api/v1/guardian/identity", guardian);
  expect(started).toEqual({ status: 200, body: { url: expect.stringMatching(/^https:\/\/verify\.stripe\.com\//) } });
  const id = accountOf(guardian).identity_session_id as string;
  identity[id] = { status: "verified", dob };
  return deliver("identity.verification_session.verified", { id, object: "identity.verification_session", status: "verified", metadata: { account_id: accountOf(guardian).id, purpose: "ascentra_guardian" } });
}
const AGREED = { agreed: { teen_terms: "v0.2", minor_privacy_notice: "v0.2" } };
const CHECKOUT = { plan: "basic", agreed: true, termsVersion: RENEWAL_TERMS_VERSION, usResident: true };
function teenSub(id: string, guardianId: string, teenId: string, o: Partial<Stripe.Subscription> = {}) {
  return {
    id, object: "subscription", customer: "cus_guardian", status: "trialing", start_date: now(), cancel_at_period_end: false, cancel_at: null,
    canceled_at: null, ended_at: null, trial_start: now(), trial_end: now() + 14 * DAY,
    metadata: { account_id: guardianId, beneficiary_account_id: teenId },
    items: { object: "list", data: [{ price: { id: ENV.STRIPE_PRICE_BASIC }, current_period_start: now(), current_period_end: now() + 14 * DAY }] },
    ...o,
  } as unknown as Stripe.Subscription;
}
const completed = (subId: string, guardianId: string, teenId: string) => ({
  id: "cs_1", object: "checkout.session", mode: "subscription", subscription: subId, customer: "cus_guardian", client_reference_id: guardianId,
  metadata: { account_id: guardianId, beneficiary_account_id: teenId }, customer_details: { address: { country: "US" } },
});

describe("the Guardian, from the teen's invitation to an active teen", () => {
  it("runs the whole flow, and each step waits for the one before", async () => {
    const { teenId, guardianId } = await teenAndGuardian();
    // The Guardian is an adult Guardian account; the teen is still pending.
    expect(accountOf("user_mom")).toMatchObject({ role: "guardian", status: "active", is_minor: false });
    expect(links()).toEqual([expect.objectContaining({ teen_account_id: teenId, guardian_account_id: guardianId, verification_status: "pending", relationship: "parent" })]);
    signIn("user_teen", "user_teen@example.com");
    expect((await registrationRoute.GET().then(json)).body).toMatchObject({ state: "guardian", progress: "joined" });

    // Nothing before the identity check.
    const params = { accountId: teenId };
    expect((await api(consentRoute, "POST", `/api/v1/guardian/teens/${teenId}/consent`, "user_mom", AGREED, params)).status).toBe(403);
    expect((await api(checkoutRoute, "POST", "/api/v1/billing/checkout", "user_mom", { ...CHECKOUT, teenAccountId: teenId })).body.reason).toMatch(/Verify your identity/);

    // Stripe Identity: only "verified" with an adult date of birth continues. Status and date kept; no images, no date of birth.
    expect((await verifyIdentity()).body.outcome).toBe("identity_verified");
    expect(accountOf("user_mom")).toMatchObject({ identity_status: "verified", identity_verified_at: expect.any(String) });
    expect(JSON.stringify(accountOf("user_mom"))).not.toMatch(/1980|dob|image/);
    expect(calls.identity[0]).toMatchObject({ type: "document", metadata: { account_id: guardianId, purpose: "ascentra_guardian" }, return_url: "https://ascentra.test/guardian?identity=done" });

    // Consent: one consent_records row per document, with its version; checkout before that is refused.
    expect((await api(checkoutRoute, "POST", "/api/v1/billing/checkout", "user_mom", { ...CHECKOUT, teenAccountId: teenId })).body.reason).toMatch(/Teen Terms/);
    expect((await api(consentRoute, "POST", `/api/v1/guardian/teens/${teenId}/consent`, "user_mom", { agreed: { teen_terms: "v0.2" } }, params)).status).toBe(400);
    expect((await api(consentRoute, "POST", `/api/v1/guardian/teens/${teenId}/consent`, "user_mom", AGREED, params)).status).toBe(200);
    expect(db.data.consent_records).toEqual([
      expect.objectContaining({ account_id: teenId, actor_account_id: guardianId, relation: "guardian_for_teen", legal_document_version_id: "doc-teen_terms", status: "given" }),
      expect.objectContaining({ account_id: teenId, actor_account_id: guardianId, relation: "guardian_for_teen", legal_document_version_id: "doc-minor_privacy_notice", status: "given" }),
    ]);

    // Checkout: the Guardian is the customer of record; the teen is the beneficiary; billing consent is its own row.
    const co = await api(checkoutRoute, "POST", "/api/v1/billing/checkout", "user_mom", { ...CHECKOUT, teenAccountId: teenId });
    expect(co.status).toBe(200);
    expect(calls.checkout[0]).toMatchObject({
      customer: "cus_guardian", client_reference_id: guardianId, success_url: "https://ascentra.test/guardian?billing=success",
      subscription_data: { metadata: { account_id: guardianId, beneficiary_account_id: teenId } },
    });
    expect(db.data.consent_records[2]).toMatchObject({ account_id: teenId, actor_account_id: guardianId, relation: "guardian_for_teen", legal_document_version_id: "doc-art" });

    // Stripe confirms: the teen is active, with teen defaults.
    subs.sub_t = teenSub("sub_t", guardianId, teenId);
    expect((await deliver("checkout.session.completed", completed("sub_t", guardianId, teenId))).body.outcome).toMatch(/teen_activated/);
    expect(db.data.subscriptions[0]).toMatchObject({ payer_account_id: guardianId, beneficiary_account_id: teenId, plan: "trial" });
    expect(db.data.entitlements[0]).toMatchObject({ account_id: teenId, tier: "trial" });
    expect(accountOf("user_teen").status).toBe("active");
    expect(links()[0]).toMatchObject({ verification_status: "verified", authorized_at: expect.any(String), voice_recordings: "off", uploads: "private" });
    expect(db.data.notification_preferences).toEqual([expect.objectContaining({ account_id: teenId, email: false, in_app: true })]);
    expect(audit("guardian.teen.activate")).toEqual([expect.objectContaining({ result: "completed", target_id: teenId })]);
    // Repeated events change nothing more.
    await deliver("customer.subscription.updated", subs.sub_t);
    expect(audit("guardian.teen.activate")).toHaveLength(1);

    signIn("user_teen", "user_teen@example.com");
    // R1: once active, the teen does the interview next (their Guardian has the plan), then lands on the learner home.
    expect((await registrationRoute.GET().then(json)).body).toEqual({ state: "interview", next: "/learn/choose?onboarding=1" });
    expect(await getAccount()).toMatchObject({ roleKey: "learner", isMinor: true });
    const overview = await api(overviewRoute, "GET", "/api/v1/guardian", "user_mom");
    expect(overview.body.teens).toEqual([expect.objectContaining({ id: teenId, status: "active", link: "verified", subscription: expect.objectContaining({ plan: "trial" }) })]);
  });

  it("an identity check that doesn't show an adult fails, and the teen can invite someone else", async () => {
    const { teenId } = await teenAndGuardian();
    expect((await verifyIdentity("user_mom", { day: 1, month: 1, year: new Date().getFullYear() - 16 })).body.outcome).toBe("identity_failed");
    expect(accountOf("user_mom")).toMatchObject({ identity_status: "failed", identity_verified_at: null });
    expect(links()[0].verification_status).toBe("failed");
    signIn("user_teen", "user_teen@example.com");
    expect((await registrationRoute.GET().then(json)).body).toMatchObject({ state: "guardian", progress: "failed", guardianEmail: null });
    expect((await postP(teenInviteRoute, { guardianEmail: "dad@example.com" })).status).toBe(201);
    expect(links().filter((l) => l.teen_account_id === teenId && l.verification_status !== "failed")).toHaveLength(1);
  });

  it("a verified session without a date of birth isn't enough; requires_input can be retried; another session's event is ignored", async () => {
    await teenAndGuardian();
    await api(identityRoute, "POST", "/api/v1/guardian/identity", "user_mom");
    const first = accountOf("user_mom").identity_session_id as string;
    identity[first] = { status: "requires_input" };
    const meta = { account_id: accountOf("user_mom").id, purpose: "ascentra_guardian" };
    expect((await deliver("identity.verification_session.requires_input", { id: first, metadata: meta })).body.outcome).toBe("identity_requires_input");
    await api(identityRoute, "POST", "/api/v1/guardian/identity", "user_mom");
    expect((await deliver("identity.verification_session.verified", { id: first, metadata: meta })).body.outcome).toBe("ignored_session");
    const second = accountOf("user_mom").identity_session_id as string;
    identity[second] = { status: "verified", dob: null };
    expect((await deliver("identity.verification_session.verified", { id: second, metadata: meta })).body.outcome).toBe("identity_failed");
  });

  it("the invitation works only for the invited, verified email, and only once", async () => {
    signIn("user_teen", "user_teen@example.com");
    await postP(registrationRoute, { dateOfBirth: yearsAgo(15), usResident: true });
    await postP(teenInviteRoute, { guardianEmail: "mom@example.com" });
    const linkId = links()[0].id;
    signIn("user_other", "other@example.com", { ascentra_guardian_invite_id: linkId });
    expect((await registrationRoute.GET().then(json)).body.state).toBe("not_open");
    expect((await postP(guardianAccountRoute, { adult: true, usResident: true, relationship: "parent" })).status).toBe(403);
    signIn("user_mom", "mom@example.com", { ascentra_guardian_invite_id: linkId });
    expect((await registrationRoute.GET().then(json)).body).toEqual({ state: "guardian_signup", teenName: "Olive" });
    expect((await postP(guardianAccountRoute, { adult: false, usResident: true, relationship: "parent" })).status).toBe(400);
    expect((await postP(guardianAccountRoute, { adult: true, usResident: true, relationship: "parent" })).status).toBe(201);
    signIn("user_mom_twin", "mom@example.com", { ascentra_guardian_invite_id: linkId });
    expect((await postP(guardianAccountRoute, { adult: true, usResident: true, relationship: "parent" })).status).toBe(403);
    expect(db.data.accounts.filter((a) => a.role === "guardian" && a.email === "mom@example.com")).toHaveLength(1);
  });

  it("a Guardian needs a second factor before the Guardian Center works", async () => {
    signIn("user_teen", "user_teen@example.com");
    await postP(registrationRoute, { dateOfBirth: yearsAgo(15), usResident: true });
    await postP(teenInviteRoute, { guardianEmail: "mom@example.com" });
    const u = clerkUser({ id: "user_mom", email: "mom@example.com", passwordEnabled: true, twoFactorEnabled: false }) as unknown as Record<string, unknown>;
    u.public_metadata = { ascentra_guardian_invite_id: links()[0].id };
    clerk.users.user_mom = u;
    clerk.userId = "user_mom";
    expect((await postP(guardianAccountRoute, { adult: true, usResident: true, relationship: "legal_guardian" })).body).toEqual({ state: "second_factor" });
    expect(await getAccount()).toBeNull();
  });
});

describe("one Guardian, several teens; one Guardian of record per teen", () => {
  it("links a second teen to an existing Guardian at once, without a new sign-up", async () => {
    const { guardianId } = await teenAndGuardian("user_teen_a");
    const before = clerk.invites.length;
    const { teenId: second } = await teenAndGuardian("user_teen_b");
    expect(clerk.invites.length).toBe(before);
    expect(links().filter((l) => l.guardian_account_id === guardianId)).toHaveLength(2);
    const overview = await api(overviewRoute, "GET", "/api/v1/guardian", "user_mom");
    expect(overview.body.teens.map((t: { id: string }) => t.id)).toContain(second);
  });

  it("a teen whose Guardian has joined can't switch to another Guardian; a learner or staff email can't be a Guardian", async () => {
    await teenAndGuardian();
    signIn("user_teen", "user_teen@example.com");
    expect((await postP(teenInviteRoute, { guardianEmail: "dad@example.com" })).status).toBe(409);
    signIn("user_teen_c", "user_teen_c@example.com");
    await postP(registrationRoute, { dateOfBirth: yearsAgo(16), usResident: true });
    for (const email of ["learner@example.com", "support@example.com", TEST_ENV.OWNER_EMAIL]) {
      expect((await postP(teenInviteRoute, { guardianEmail: email })).status, email).toBe(400);
    }
  });

  it("a subscription naming a teen who isn't the payer's is paid for the payer, and activates nobody", async () => {
    const { teenId } = await teenAndGuardian();
    const learner = ROLE_ID.learner;
    db.data.billing_customers = [{ account_id: learner, processor_customer_id: "cus_learner" }];
    subs.sub_x = teenSub("sub_x", learner, teenId, { customer: "cus_learner" } as Partial<Stripe.Subscription>);
    await deliver("customer.subscription.created", subs.sub_x);
    expect(db.data.subscriptions[0]).toMatchObject({ payer_account_id: learner, beneficiary_account_id: learner });
    expect(accountOf("user_teen").status).toBe("pending");
  });
});

describe("withdrawing consent", () => {
  async function activeTeen() {
    const ids = await teenAndGuardian();
    await verifyIdentity();
    await api(consentRoute, "POST", `/api/v1/guardian/teens/${ids.teenId}/consent`, "user_mom", AGREED, { accountId: ids.teenId });
    await api(checkoutRoute, "POST", "/api/v1/billing/checkout", "user_mom", { ...CHECKOUT, teenAccountId: ids.teenId });
    subs.sub_t = teenSub("sub_t", ids.guardianId, ids.teenId);
    await deliver("checkout.session.completed", completed("sub_t", ids.guardianId, ids.teenId));
    expect(accountOf("user_teen").status).toBe("active");
    return ids;
  }
  const withdraw = (teenId: string, body: Record<string, unknown>) =>
    api(withdrawRoute, "POST", `/api/v1/guardian/teens/${teenId}/withdraw`, "user_mom", body, { accountId: teenId });

  it("needs a reason; then pauses the teen (nothing deleted), records each withdrawal, ends the plan at period end; both are told", async () => {
    const { teenId, guardianId } = await activeTeen();
    expect((await withdraw(teenId, {})).status).toBe(400);
    const accounts = db.data.accounts.length;
    const r = await withdraw(teenId, { reason: "We are taking a break" });
    expect(r).toMatchObject({ status: 200, body: { withdrawn: true } });
    expect(db.data.accounts.length).toBe(accounts);
    expect(accountOf("user_teen").status).toBe("paused");
    expect(links()[0]).toMatchObject({ withdrawn_at: expect.any(String), withdrawal_reason: "We are taking a break" });
    expect(calls.updates).toEqual([["sub_t", { cancel_at_period_end: true }]]);
    const withdrawn = db.data.consent_records.filter((c) => c.status === "withdrawn");
    expect(withdrawn.map((c) => c.legal_document_version_id).sort()).toEqual(["doc-art", "doc-minor_privacy_notice", "doc-teen_terms"]);
    expect(withdrawn.every((c) => c.actor_account_id === guardianId && c.account_id === teenId)).toBe(true);
    // The reasonless attempt is recorded as refused; the withdrawal itself once, with its reason.
    expect(audit("guardian.consent.withdraw").map((e) => e.result)).toEqual(["blocked", "completed"]);
    expect(audit("guardian.consent.withdraw")[1]).toMatchObject({ reason: "We are taking a break", new_value: "paused" });

    // The teen is told, and can do nothing; Stripe's later events don't bring the account back.
    signIn("user_teen", "user_teen@example.com");
    expect((await registrationRoute.GET().then(json)).body).toEqual({ state: "paused", since: links()[0].withdrawn_at });
    expect(await getAccount()).toBeNull();
    await deliver("customer.subscription.updated", subs.sub_t);
    expect(accountOf("user_teen").status).toBe("paused");
    // The Guardian is told.
    const overview = await api(overviewRoute, "GET", "/api/v1/guardian", "user_mom");
    expect(overview.body.teens[0]).toMatchObject({ status: "paused", link: "withdrawn", withdrawnAt: expect.any(String) });
  });

  it("only the teen's own Guardian can withdraw", async () => {
    const { teenId } = await activeTeen();
    db.data.trusted_devices.push(trustedDeviceRow(ROLE_ID.guardian));
    expect((await api(withdrawRoute, "POST", `/api/v1/guardian/teens/${teenId}/withdraw`, clerkIdOf("guardian"), { reason: "Not my teen at all" }, { accountId: teenId })).status).toBe(404);
    expect((await api(withdrawRoute, "POST", `/api/v1/guardian/teens/${teenId}/withdraw`, clerkIdOf("learner"), { reason: "Not my teen at all" }, { accountId: teenId })).status).toBe(403);
    expect(accountOf("user_teen").status).toBe("active");
  });
});

