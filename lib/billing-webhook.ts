import "server-only";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import type { BillingEnv } from "@/lib/billing-env";
import { accountOfCustomer, applySubscription } from "@/lib/billing";
import { ALLOWED_COUNTRY, PLANS, RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";
import { activateTeenIfPaid, applyIdentityEvent } from "@/lib/guardians";
import { noticeCanceled, noticeEnded, noticePaymentFailed } from "@/lib/notices";

const ACTOR = SYSTEM_ACTOR("Stripe webhook");
/** The Stripe events the endpoint must be subscribed to (see db/README.md, B1 and B3). */
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // B3: a Guardian's identity and adult check (Stripe Identity).
  "identity.verification_session.processing",
  "identity.verification_session.verified",
  "identity.verification_session.requires_input",
  "identity.verification_session.canceled",
] as const;

const customerId = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null) => (c == null ? null : typeof c === "string" ? c : c.id);

function subscriptionOfInvoice(inv: Stripe.Invoice): string | null {
  const s = inv.parent?.subscription_details?.subscription;
  return s == null ? null : typeof s === "string" ? s : s.id;
}

/** Has this Stripe event already been applied? */
export async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data } = await getDb().from("billing_events").select("id").eq("processor_event_id", eventId).maybeSingle();
  return !!data;
}

async function remember(event: Stripe.Event, outcome: string, accountId: string | null) {
  const { error } = await getDb().from("billing_events").insert({ processor_event_id: event.id, type: event.type, outcome, account_id: accountId });
  // 23505: a parallel delivery of the same event recorded it first. Both applied the same state.
  if (error && error.code !== "23505") throw new Error(`billing event record failed: ${error.message}`);
}

async function ensureCustomer(accountId: string, customer: string) {
  const known = await accountOfCustomer(customer);
  if (known) return;
  const { error } = await getDb().from("billing_customers").insert({ account_id: accountId, processor_customer_id: customer });
  if (error && error.code !== "23505") throw new Error(`billing customer insert failed: ${error.message}`);
}

/** The trial disclosure as shown and agreed (trial_consents), once per trialing subscription. */
async function recordTrialConsent(subRowId: string, accountId: string, sub: Stripe.Subscription, consentRecordId: string | undefined) {
  if (!sub.trial_end) return;
  const db = getDb();
  const { data: exists } = await db.from("trial_consents").select("id").eq("subscription_id", subRowId).maybeSingle();
  if (exists) return;
  const { data: doc } = await db.from("legal_document_versions").select("id").eq("document_key", RENEWAL_TERMS_KEY).eq("version", RENEWAL_TERMS_VERSION).maybeSingle();
  const consent = consentRecordId
    ? ((await db.from("consent_records").select("consented_at").eq("id", consentRecordId).maybeSingle()).data as { consented_at: string } | null)
    : null;
  if (!doc) throw new Error("Automatic Renewal Terms v0.1 is missing (apply db/apply/B1.sql)");
  const trialEnd = new Date(sub.trial_end * 1000);
  const { error } = await db.from("trial_consents").insert({
    subscription_id: subRowId, account_id: accountId, disclosure_document_version_id: (doc as { id: string }).id,
    trial_ends_at: trialEnd.toISOString(), first_charge_at: trialEnd.toISOString(), first_charge_amount_cents: PLANS.basic.cents,
    currency: "USD", disclosed_at: consent?.consented_at ?? new Date().toISOString(),
    reminder_scheduled_for: new Date(trialEnd.getTime() - 3 * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`trial consent insert failed: ${error.message}`);
}

/**
 * Applies one verified Stripe event. Every subscription change re-reads the subscription from Stripe,
 * so the newest state wins whatever order events arrive in. Throws on a failure, so the endpoint
 * answers 500 and Stripe retries; the event is recorded only once it has been applied.
 */
export async function handleStripeEvent(event: Stripe.Event, stripe: Stripe, env: BillingEnv): Promise<{ outcome: string; accountId: string | null }> {
  const at = new Date(event.created * 1000);
  const sync = async (subId: string, accountId?: string | null) => {
    const r = await applySubscription(await stripe.subscriptions.retrieve(subId), env, { accountId, eventId: event.id, eventAt: at });
    // B3: a Guardian's plan for a teen is live → the teen becomes active (safe to repeat).
    const teen = r.row ? await activateTeenIfPaid(r.row, event.id) : null;
    // B4: the payer is emailed when a plan is canceled (access continues to the period end) or has ended.
    if (r.row && r.previous && r.row.status !== r.previous.status) {
      if (r.row.status === "canceled") await noticeCanceled(r.row);
      if (r.row.status === "ended") await noticeEnded(r.row);
    }
    return teen ? { ...r, outcome: `${r.outcome}; ${teen}` } : r;
  };

  let result: { outcome: string; accountId: string | null } = { outcome: "ignored", accountId: null };
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode !== "subscription" || !s.subscription) break;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
      const accountId = s.client_reference_id ?? s.metadata?.account_id ?? null;
      const customer = customerId(s.customer);
      if (accountId && customer) await ensureCustomer(accountId, customer);
      const country = s.customer_details?.address?.country ?? null;
      if (country !== ALLOWED_COUNTRY) {
        // US only: end it at once. Anything already charged is refunded in the Stripe dashboard.
        await stripe.subscriptions.cancel(subId, { invoice_now: false, prorate: false });
        await recordAudit({
          actor: ACTOR, action: "billing.subscription.change", result: "Blocked", requestId: event.id, sensitive: true,
          context: `Refused a checkout with a billing address outside the United States (${country ?? "none"}). The subscription was canceled at once; refund any charge in Stripe.`,
          target: accountId ? { type: "account", id: accountId } : { type: "subscription", id: subId },
        });
        const r = await sync(subId, accountId);
        result = { outcome: "refused_outside_us", accountId: r.accountId ?? accountId };
        break;
      }
      const r = await sync(subId, accountId);
      if (r.row && r.accountId && r.row.status === "trialing") {
        await recordTrialConsent(r.row.id, r.accountId, await stripe.subscriptions.retrieve(subId), s.metadata?.consent_record_id);
      }
      result = { outcome: r.outcome, accountId: r.accountId };
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const r = await sync(event.data.object.id);
      result = { outcome: r.outcome, accountId: r.accountId };
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object;
      const subId = subscriptionOfInvoice(inv);
      if (!subId) break;
      const r = await sync(subId);
      // B4: Stripe retries the payment; the payer (a teen's Guardian) is emailed and sees a banner on the site.
      if (event.type === "invoice.payment_failed" && r.row) await noticePaymentFailed(r.row, inv.id ?? `${subId}:${event.id}`, inv.amount_due ?? 0);
      if (event.type === "invoice.payment_failed" && r.accountId) {
        await recordAudit({
          actor: ACTOR, action: "billing.payment_failed", result: "Completed", requestId: event.id,
          context: `A payment of $${((inv.amount_due ?? 0) / 100).toFixed(2)} failed. Stripe retries it; access continues while it does.`,
          target: { type: "account", id: r.accountId },
        });
      }
      result = { outcome: r.outcome, accountId: r.accountId };
      break;
    }
    case "identity.verification_session.processing":
    case "identity.verification_session.verified":
    case "identity.verification_session.requires_input":
    case "identity.verification_session.canceled":
      result = await applyIdentityEvent(event, stripe);
      break;
  }
  await remember(event, result.outcome, result.accountId);
  return result;
}
