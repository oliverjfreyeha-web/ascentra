import "server-only";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { recordAudit, SYSTEM_ACTOR, type AuditActor } from "@/lib/audit";
import { decide, type RoleKey } from "@/lib/caps";
import type { BillingEnv } from "@/lib/billing-env";
import { PLANS, type PaidPlan } from "@/lib/billing-terms";
import { mayPayFor } from "@/lib/guardians";

/**
 * Subscriptions and entitlements, kept in step with Stripe. Stripe is the source of truth for the
 * lifecycle; the webhook (app/api/webhooks/stripe) writes it here, and the server reads the
 * entitlement from this database on every request that needs it. Nothing a browser sends decides
 * a plan, a price or a tier.
 */

export type SubStatus = "trialing" | "active" | "past_due" | "canceled" | "ended";
export type Tier = "none" | "trial" | "basic" | "pro" | "full";
const TIER_RANK: Record<Tier, number> = { none: 0, trial: 1, basic: 2, pro: 3, full: 4 };

export type SubscriptionRow = {
  id: string;
  payer_account_id: string;
  beneficiary_account_id: string;
  plan: "trial" | "basic" | "pro";
  status: SubStatus;
  started_at: string;
  trial_ends_at: string | null;
  first_charge_at: string | null;
  renews_at: string | null;
  paid_through_at: string | null;
  canceled_at: string | null;
  cancel_at_period_end: boolean;
  processor_subscription_id: string | null;
  processor_customer_id: string | null;
  processor_price_id: string | null;
  processor_status: string | null;
  processor_updated_at: string | null;
  created_at: string;
};

const iso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

export function planOfPrice(priceId: string | null | undefined, env: Pick<BillingEnv, "STRIPE_PRICE_BASIC" | "STRIPE_PRICE_PRO">): PaidPlan | null {
  if (priceId === env.STRIPE_PRICE_BASIC) return "basic";
  if (priceId === env.STRIPE_PRICE_PRO) return "pro";
  return null;
}

/**
 * Stripe's subscription, as our row. Pure, so the lifecycle rules are tested on their own:
 *   trialing → trialing (plan "trial": it converts to Basic);
 *   active, and past_due/unpaid (Stripe is retrying the payment) → active / past_due;
 *   set to cancel at the end of the period → canceled (access continues until then);
 *   canceled, incomplete_expired, paused → ended (no access);
 *   incomplete (the first payment hasn't gone through) → null: nothing to record yet.
 */
export type MappedRow = Omit<SubscriptionRow, "id" | "payer_account_id" | "beneficiary_account_id" | "created_at" | "processor_updated_at">;
export type Mapped = { row: MappedRow; pricePlan: PaidPlan } | { error: string } | { skip: string };

export function mapSubscription(sub: Stripe.Subscription, env: Pick<BillingEnv, "STRIPE_PRICE_BASIC" | "STRIPE_PRICE_PRO">): Mapped {
  const item = sub.items.data[0];
  const pricePlan = planOfPrice(item?.price?.id, env);
  if (!pricePlan) return { error: `unknown price ${item?.price?.id ?? "(none)"}` };
  let status: SubStatus;
  switch (sub.status) {
    case "trialing":
      status = sub.cancel_at_period_end || sub.cancel_at ? "canceled" : "trialing";
      break;
    case "active":
      status = sub.cancel_at_period_end || sub.cancel_at ? "canceled" : "active";
      break;
    case "past_due":
    case "unpaid":
      status = "past_due";
      break;
    case "canceled":
    case "incomplete_expired":
    case "paused":
      status = "ended";
      break;
    default:
      return { skip: `status ${sub.status}` };
  }
  const trial = sub.status === "trialing" || (status === "canceled" && sub.trial_end != null && sub.trial_end * 1000 > Date.now());
  const periodEnd = iso(item.current_period_end);
  const endsAt = iso(sub.cancel_at) ?? periodEnd;
  return {
    row: {
      plan: trial ? "trial" : pricePlan,
      status,
      started_at: iso(sub.start_date)!,
      trial_ends_at: iso(sub.trial_end),
      first_charge_at: iso(sub.trial_end) ?? iso(sub.start_date),
      renews_at: status === "active" || status === "trialing" || status === "past_due" ? periodEnd : null,
      paid_through_at: status === "ended" ? iso(sub.ended_at) ?? iso(sub.canceled_at) : status === "canceled" ? endsAt : periodEnd,
      canceled_at: iso(sub.canceled_at),
      cancel_at_period_end: status === "canceled",
      processor_subscription_id: sub.id,
      processor_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      processor_price_id: item.price.id,
      processor_status: sub.status,
    },
    pricePlan,
  };
}

/** The entitlement a subscription row gives: tier and until when. */
export function entitlementOf(row: Pick<SubscriptionRow, "plan" | "status" | "paid_through_at" | "trial_ends_at" | "started_at">, now = new Date()) {
  const tier: Tier = row.status === "ended" ? "none" : row.plan === "trial" ? "trial" : row.plan;
  const until =
    row.status === "ended" ? (row.paid_through_at ?? now.toISOString())
      : row.status === "canceled" ? (row.paid_through_at ?? row.trial_ends_at)
        : null;
  return { tier, valid_from: row.started_at, valid_until: until };
}

const WEBHOOK_ACTOR: AuditActor = SYSTEM_ACTOR("Stripe webhook");
const label = (r: { plan: string; status: string } | null) => (r ? `${r.plan} (${r.status})` : "none");

/**
 * Writes Stripe's current view of one subscription: the subscriptions row, its entitlement row, and an
 * audit event when the plan or status changed. Safe to repeat: the same Stripe state writes the same rows.
 */
export async function applySubscription(
  sub: Stripe.Subscription,
  env: BillingEnv,
  opts: { accountId?: string | null; eventId: string; eventAt: Date; retried?: boolean },
): Promise<{ outcome: string; accountId: string | null; row?: SubscriptionRow }> {
  const db = getDb();
  const mapped = mapSubscription(sub, env);
  if ("error" in mapped) {
    await recordAudit({
      actor: WEBHOOK_ACTOR, action: "billing.subscription.sync", result: "Blocked",
      context: `Refused a Stripe subscription with a price that isn't Basic or Pro: ${mapped.error}. Nothing was changed.`,
      target: { type: "subscription", id: sub.id }, requestId: opts.eventId,
    });
    return { outcome: "unknown_price", accountId: null };
  }
  if ("skip" in mapped) return { outcome: `skipped (${mapped.skip})`, accountId: null };

  const found = (await db.from("subscriptions").select("*").eq("processor_subscription_id", sub.id).maybeSingle()).data as SubscriptionRow | null;
  // A copy: the before-and-after comparison below must see the state before this write.
  const existing = found ? { ...found } : null;
  const accountId = existing?.payer_account_id ?? opts.accountId ?? (await accountOfCustomer(mapped.row.processor_customer_id)) ?? (sub.metadata?.account_id || null);
  if (!accountId) return { outcome: "no_account", accountId: null };

  // An older event never overwrites a newer state.
  if (existing?.processor_updated_at && new Date(existing.processor_updated_at) > opts.eventAt) return { outcome: "stale", accountId, row: existing };

  const fields = { ...mapped.row, processor_updated_at: opts.eventAt.toISOString(), updated_at: new Date().toISOString() };
  let row: SubscriptionRow;
  if (existing) {
    const { data, error } = await db.from("subscriptions").update(fields).eq("id", existing.id).select("*").single();
    if (error) throw new Error(`subscription update failed: ${error.message}`);
    row = data as SubscriptionRow;
  } else {
    // B3: a Guardian pays for a teen. The teen named in the metadata (written by our checkout) is used only if
    // the payer is that teen's Guardian of record; otherwise the payer is the beneficiary.
    const named = sub.metadata?.beneficiary_account_id;
    const beneficiary = named && named !== accountId && (await mayPayFor(accountId, named)) ? named : accountId;
    const { data, error } = await db.from("subscriptions")
      .insert({ ...fields, payer_account_id: accountId, beneficiary_account_id: beneficiary }).select("*").single();
    // 23505: Stripe sends several events for a new subscription at once, and a parallel delivery inserted
    // it first. Apply this event again as an update of that row (once).
    if (error?.code === "23505" && !opts.retried) return applySubscription(sub, env, { ...opts, retried: true });
    if (error) throw new Error(`subscription insert failed: ${error.message}`);
    row = data as SubscriptionRow;
  }

  const ent = entitlementOf(row);
  const current = (await db.from("entitlements").select("id").eq("subscription_id", row.id).maybeSingle()).data as { id: string } | null;
  const entFields = {
    account_id: row.beneficiary_account_id, source: "subscription", subscription_id: row.id,
    tier: ent.tier === "none" ? row.plan : ent.tier, valid_from: ent.valid_from, valid_until: ent.valid_until,
    computed_at: new Date().toISOString(),
  };
  let { error: entErr } = current
    ? await db.from("entitlements").update(entFields).eq("id", current.id)
    : await db.from("entitlements").insert(entFields);
  // 23505: a parallel delivery created this subscription's entitlement first; update it instead.
  if (entErr?.code === "23505") ({ error: entErr } = await db.from("entitlements").update(entFields).eq("subscription_id", row.id));
  if (entErr) throw new Error(`entitlement write failed: ${entErr.message}`);

  if (!existing || existing.plan !== row.plan || existing.status !== row.status || existing.cancel_at_period_end !== row.cancel_at_period_end) {
    await recordAudit({
      actor: WEBHOOK_ACTOR, action: "billing.subscription.change", result: "Completed", requestId: opts.eventId,
      context: existing
        ? `Subscription changed in Stripe: ${label(existing)} → ${label(row)}.`
        : `Subscription started in Stripe: ${label(row)}${row.trial_ends_at ? `, trial ends ${row.trial_ends_at.slice(0, 10)}` : ""}.`,
      target: { type: "account", id: accountId }, previous: label(existing), next: label(row), sensitive: true,
    });
  }
  return { outcome: existing ? "updated" : "created", accountId, row };
}

export async function accountOfCustomer(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await getDb().from("billing_customers").select("account_id").eq("processor_customer_id", customerId).maybeSingle();
  return (data as { account_id: string } | null)?.account_id ?? null;
}

export async function customerOf(accountId: string): Promise<string | null> {
  const { data } = await getDb().from("billing_customers").select("processor_customer_id").eq("account_id", accountId).maybeSingle();
  return (data as { processor_customer_id: string } | null)?.processor_customer_id ?? null;
}

/** The account's newest subscription (any status), or null. */
export async function latestSubscription(accountId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb().from("subscriptions").select("*").eq("beneficiary_account_id", accountId)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`subscription lookup failed: ${error.message}`);
  return ((data ?? []) as SubscriptionRow[])[0] ?? null;
}

/** The free trial is for the first subscription only: any earlier subscription, in any state, uses it up. */
export async function trialEligible(accountId: string): Promise<boolean> {
  const { count, error } = await getDb().from("subscriptions").select("id", { count: "exact", head: true }).eq("payer_account_id", accountId);
  if (error) throw new Error(`subscription count failed: ${error.message}`);
  return !count;
}

export const LIVE_STATUSES: SubStatus[] = ["trialing", "active", "past_due", "canceled"];

/**
 * What this account may use, read from the database now. Staff access comes from the capability map
 * (the Owner: everything; Super Admin: Pro; other admins: Basic); everyone else from their entitlements.
 */
export async function tierOf(account: { id: string; roleKey: RoleKey }, now = new Date()): Promise<{ tier: Tier; source: string }> {
  if (account.roleKey === "owner") return { tier: "full", source: "owner" };
  const p = { role: account.roleKey, assignedCourses: [] as string[] };
  if (decide(p, "access.pro").allowed) return { tier: "pro", source: "role" };
  const staffBasic = decide(p, "access.basic").allowed;
  const { data, error } = await getDb().from("entitlements").select("tier, valid_from, valid_until").eq("account_id", account.id);
  if (error) throw new Error(`entitlement lookup failed: ${error.message}`);
  let best: Tier = staffBasic ? "basic" : "none";
  for (const e of (data ?? []) as { tier: Tier; valid_from: string; valid_until: string | null }[]) {
    const live = new Date(e.valid_from) <= now && (e.valid_until == null || new Date(e.valid_until) > now);
    if (live && TIER_RANK[e.tier] > TIER_RANK[best]) best = e.tier;
  }
  return { tier: best, source: best === "none" ? "none" : staffBasic && best === "basic" ? "role" : "subscription" };
}

export const hasPro = (t: Tier) => t === "pro" || t === "full";
export const PRO_REQUIRED = "This needs the Pro plan. You can change plans from the Billing section of your Account page.";

/** The price Stripe will charge must be exactly the locked price: monthly, in US dollars. */
export function priceMatches(price: Stripe.Price, plan: PaidPlan): boolean {
  return price.active && price.currency === "usd" && price.unit_amount === PLANS[plan].cents
    && price.recurring?.interval === "month" && price.recurring.interval_count === 1 && price.type === "recurring";
}
