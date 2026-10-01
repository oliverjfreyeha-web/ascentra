import "server-only";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import type { Account } from "@/lib/auth";
import type { AuditInput } from "@/lib/audit";
import type { BillingEnv } from "@/lib/billing-env";
import { LIVE_STATUSES, customerOf, latestSubscription, priceMatches, trialEligible } from "@/lib/billing";
import {
  ALLOWED_COUNTRY, CONSENT_METHOD, PLANS, RENEWAL_TERMS_BODY, RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION, TRIAL_DAYS,
  renewalSummary, usd, type PaidPlan,
} from "@/lib/billing-terms";

type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type ActionResult =
  | { ok: true; body: Record<string, unknown>; event: Event }
  | { ok: false; status: number; reason: string; event: Event };

const blocked = (status: number, reason: string, action: string, accountId: string): ActionResult => ({
  ok: false, status, reason,
  event: { action, result: "Blocked", context: `Refused: ${reason}`, target: { type: "account", id: accountId } },
});

/**
 * Starts Stripe Checkout for Basic or Pro. The Automatic Renewal Terms must have been agreed to, in the
 * version shown; that agreement is stored (consent_records) before Stripe is contacted. The free trial
 * is the first Basic subscription only, and converts to Basic. The price Stripe charges must be the
 * locked price, or nothing starts.
 */
export async function startCheckout(args: {
  account: Account; body: Record<string, unknown>; origin: string; stripe: Stripe; env: BillingEnv;
}): Promise<ActionResult> {
  const { account, body, origin, stripe, env } = args;
  const A = "billing.subscribe";
  if (account.roleKey !== "learner") return blocked(403, "Only a learner account subscribes. Your role already includes access.", A, account.id);
  // The Guardian is the customer of record for a teen (B3).
  if (account.isMinor) return blocked(403, "A teen's plan is chosen and paid for by their Guardian.", A, account.id);
  const plan = body.plan;
  if (plan !== "basic" && plan !== "pro") return blocked(400, "Choose Basic or Pro.", A, account.id);
  if (body.agreed !== true || body.termsVersion !== RENEWAL_TERMS_VERSION) {
    return blocked(400, "Agree to the Automatic Renewal Terms before checkout.", A, account.id);
  }
  if (body.usResident !== true) return blocked(400, "ASCENTRA is available in the United States only. Confirm that you're in the US.", A, account.id);

  const current = await latestSubscription(account.id);
  if (current && LIVE_STATUSES.includes(current.status)) {
    return blocked(409, "You already have a plan. Change or cancel it from Manage billing.", A, account.id);
  }

  const db = getDb();
  const { data: doc } = await db.from("legal_document_versions").select("id, body, status")
    .eq("document_key", RENEWAL_TERMS_KEY).eq("version", RENEWAL_TERMS_VERSION).maybeSingle();
  const terms = doc as { id: string; body: string; status: string } | null;
  if (!terms || terms.status !== "published" || terms.body !== RENEWAL_TERMS_BODY) {
    console.error("[billing] Automatic Renewal Terms in the database don't match the text shown (apply db/apply/B1.sql).");
    return blocked(503, "Checkout isn't available right now. Nothing was charged.", A, account.id);
  }

  const priceId = plan === "basic" ? env.STRIPE_PRICE_BASIC : env.STRIPE_PRICE_PRO;
  const price = await stripe.prices.retrieve(priceId);
  if (!priceMatches(price, plan)) {
    console.error(`[billing] Stripe price for ${plan} isn't ${usd(PLANS[plan].cents)}/month in USD.`);
    return blocked(503, "Checkout isn't available right now. Nothing was charged.", A, account.id);
  }

  let customer = await customerOf(account.id);
  if (!customer) {
    const c = await stripe.customers.create(
      { email: account.email, metadata: { account_id: account.id } },
      { idempotencyKey: `ascentra-customer-${account.id}` },
    );
    const { error } = await db.from("billing_customers").insert({ account_id: account.id, processor_customer_id: c.id });
    if (error && error.code !== "23505") throw new Error(`billing customer insert failed: ${error.message}`);
    customer = (await customerOf(account.id)) ?? c.id;
  }

  // The first subscription only, here and in Stripe (a checkout that hasn't reached the webhook yet counts).
  const trial = plan === "basic" && (await trialEligible(account.id))
    && (await stripe.subscriptions.list({ customer, status: "all", limit: 1 })).data.length === 0;

  const { data: consent, error: consentErr } = await db.from("consent_records").insert({
    account_id: account.id, actor_account_id: account.id, relation: "self",
    legal_document_version_id: terms.id, status: "given", method: CONSENT_METHOD,
  }).select("id").single();
  if (consentErr || !consent) throw new Error(`consent insert failed: ${consentErr?.message}`);
  const consentId = (consent as { id: string }).id;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: account.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { account_id: account.id, plan, consent_record_id: consentId },
      ...(trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
    },
    payment_method_collection: "always",
    billing_address_collection: "required",
    // Explicit, never the account default: Managed Payments refuses custom_text, which carries the renewal terms.
    managed_payments: { enabled: false },
    customer_update: { address: "auto", name: "auto" },
    custom_text: { submit: { message: renewalSummary(plan, trial) } },
    metadata: { account_id: account.id, plan, consent_record_id: consentId, allowed_country: ALLOWED_COUNTRY },
    success_url: `${origin}/account?billing=success`,
    cancel_url: `${origin}/account?billing=canceled`,
  });

  return {
    ok: true,
    body: { url: session.url, trial },
    event: {
      action: A, result: "Completed", sensitive: true,
      context: `Agreed to the Automatic Renewal Terms ${RENEWAL_TERMS_VERSION} (${CONSENT_METHOD}) and opened checkout for ${PLANS[plan].name}${trial ? ` with a ${TRIAL_DAYS}-day trial` : ""}.`,
      target: { type: "account", id: account.id }, next: `${plan}${trial ? " (trial)" : ""}`,
    },
  };
}

/** Opens Stripe's customer portal (cancel, change plan, payment method). */
export async function openPortal(args: { account: Account; origin: string; stripe: Stripe; env: BillingEnv }): Promise<ActionResult> {
  const { account, origin, stripe, env } = args;
  const A = "billing.portal";
  const customer = await customerOf(account.id);
  if (!customer) return blocked(404, "There's no billing account yet. Choose a plan first.", A, account.id);
  const session = await stripe.billingPortal.sessions.create({ customer, configuration: env.STRIPE_PORTAL_CONFIG, return_url: `${origin}/account` });
  return {
    ok: true, body: { url: session.url },
    event: { action: A, result: "Completed", context: "Opened Stripe's customer portal (cancel, change plan, payment method).", target: { type: "account", id: account.id } },
  };
}

export type { PaidPlan };
