import "server-only";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import type { Account } from "@/lib/auth";
import type { ActionResult } from "@/lib/billing-actions";
import { readAddonPrices, type BillingEnv } from "@/lib/billing-env";
import { LIVE_STATUSES, addonLabel, applySubscription, latestSubscription, type SubscriptionRow } from "@/lib/billing";
import { PLANS, usd } from "@/lib/billing-terms";
import { mayPayFor, teenFirstName } from "@/lib/guardians";
import {
  ADDON_CONSENT_METHOD, MENTOR_ALLOWANCE_TERMS_BODY, MENTOR_ALLOWANCE_TERMS_KEY, MENTOR_ALLOWANCE_TERMS_VERSION, addonRenewalLine,
  choicesFor, isAllowedChoice, type AddonCents,
} from "@/lib/mentor-allowance-terms";
import type { AllowancePeriod } from "@/lib/mentor-allowance";

/**
 * L5: choosing, changing or removing the Mentor allowance add-on on a live plan. Only the payer can (a teen's
 * Guardian; never the teen). In two steps: a quote (what changes, when, and what is charged today), then the
 * confirmation, which must carry the same charge or nothing happens. The Mentor Allowance Terms are agreed to, and
 * stored as a consent record, before Stripe is contacted.
 *   - A raise takes effect at once: Stripe charges the prorated difference right away (always_invoice), and if that
 *     payment fails nothing changes (error_if_incomplete).
 *   - A lower amount or a removal takes effect at renewal: Stripe bills the new amount from the next invoice, with no
 *     proration; this period keeps the allowance already paid for.
 *   - During the free trial, nothing is charged now: the add-on is first charged when the trial converts.
 */
const A = "billing.mentor_addon.change";
type Effect = "now" | "renewal" | "conversion";

const blocked = (status: number, reason: string, accountId: string): ActionResult => ({
  ok: false, status, reason, event: { action: A, result: "Blocked", context: `Refused: ${reason}`, target: { type: "account", id: accountId } },
});

const choiceList = (plan: SubscriptionRow["plan"]) =>
  choicesFor(plan).map((c) => (c ? `${usd(c)} per month` : "none")).join(", ").replace(/, ([^,]*)$/, " or $1");

/** The terms as stored, if they're published word for word as shown. */
export async function addonTerms(): Promise<{ id: string } | null> {
  const doc = (await getDb().from("legal_document_versions").select("id, body, status")
    .eq("document_key", MENTOR_ALLOWANCE_TERMS_KEY).eq("version", MENTOR_ALLOWANCE_TERMS_VERSION).maybeSingle()).data as { id: string; body: string; status: string } | null;
  if (!doc || doc.status !== "published" || doc.body !== MENTOR_ALLOWANCE_TERMS_BODY) {
    console.error("[billing] Mentor Allowance Terms in the database don't match the text shown (apply db/apply/L5.sql).");
    return null;
  }
  return { id: doc.id };
}

/** The add-on price Stripe will charge must be exactly the amount shown: monthly, in US dollars. */
export function addonPriceMatches(price: Stripe.Price, cents: number): boolean {
  return price.active && price.currency === "usd" && price.unit_amount === cents
    && price.recurring?.interval === "month" && price.recurring.interval_count === 1 && price.type === "recurring";
}

export async function recordAddonConsent(beneficiary: string, actor: string, docId: string): Promise<string> {
  const { data, error } = await getDb().from("consent_records").insert({
    account_id: beneficiary, actor_account_id: actor, relation: beneficiary === actor ? "self" : "guardian_for_teen",
    legal_document_version_id: docId, status: "given", method: ADDON_CONSENT_METHOD,
  }).select("id").single();
  if (error || !data) throw new Error(`consent insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

async function currentPeriod(subId: string, now = new Date()): Promise<AllowancePeriod | null> {
  const rows = ((await getDb().from("mentor_allowance_periods").select("*").eq("subscription_id", subId)
    .lte("period_start", now.toISOString()).gt("period_end", now.toISOString()).order("period_start", { ascending: false }).limit(1)).data ?? []) as AllowancePeriod[];
  return rows[0] ?? null;
}

export async function changeAddon(args: {
  account: Account; body: Record<string, unknown>; stripe: Stripe; env: BillingEnv; requestId?: string | null;
}): Promise<ActionResult> {
  const { account, body, stripe, env } = args;
  if (account.isMinor) return blocked(403, "Only your Guardian can choose, change or remove your Mentor allowance.", account.id);
  if (account.roleKey !== "learner" && account.roleKey !== "guardian") return blocked(403, "Your role already includes the Mentor. There's no allowance to buy.", account.id);
  let beneficiary = account.id;
  if (account.roleKey === "guardian") {
    const teen = body.teenAccountId;
    if (typeof teen !== "string" || !(await mayPayFor(account.id, teen))) return blocked(404, "This teen isn't linked to your account.", account.id);
    beneficiary = teen;
  }
  const forTeen = beneficiary !== account.id;
  const sub = await latestSubscription(beneficiary);
  if (!sub || !LIVE_STATUSES.includes(sub.status) || !sub.processor_subscription_id) return blocked(404, "Choose a plan first. The Mentor allowance is an add-on to a plan.", account.id);
  if (sub.payer_account_id !== account.id) return blocked(403, "Only the person who pays for the plan can change the Mentor allowance.", account.id);
  if (sub.status === "canceled") return blocked(409, "This plan is canceled, so its Mentor allowance can't change. It stays as it is until the plan ends.", account.id);

  const amount = body.amountCents;
  if (!isAllowedChoice(sub.plan, amount)) return blocked(400, `Choose ${choiceList(sub.plan)} for the ${sub.plan === "pro" ? "Pro" : "Basic"} plan.`, account.id);
  const now = new Date();
  const period = await currentPeriod(sub.id, now);
  const paid = period?.addon_cents ?? 0;
  const billed = sub.mentor_addon_cents ?? 0;
  const trial = sub.plan === "trial";
  if (amount === billed) {
    return blocked(409, amount < paid && !trial
      ? `Your Mentor allowance is already set to ${addonLabel(amount)} from the next renewal.`
      : `Your Mentor allowance is already ${addonLabel(amount)}.`, account.id);
  }
  const raise = !trial && amount > paid;
  const effect: Effect = trial ? "conversion" : amount >= paid ? "now" : "renewal";
  if (raise && sub.status === "past_due") return blocked(409, "The last payment for this plan failed. Update the payment method in Manage billing before raising the Mentor allowance.", account.id);

  const prices = readAddonPrices();
  if (!prices.ok) {
    console.error("[billing] Mentor allowance not configured:", prices.problems.join("; "));
    return blocked(503, "The Mentor allowance isn't available yet. Nothing was charged.", account.id);
  }
  const terms = await addonTerms();
  if (!terms) return blocked(503, "The Mentor allowance isn't available right now. Nothing was charged.", account.id);
  const priceOf = (c: number) => prices.byCents[c as 500 | 1000 | 2000];
  if (amount > 0 && !addonPriceMatches(await stripe.prices.retrieve(priceOf(amount)), amount)) {
    console.error(`[billing] Stripe price for the ${usd(amount)} Mentor allowance isn't ${usd(amount)}/month in USD.`);
    return blocked(503, "The Mentor allowance isn't available right now. Nothing was charged.", account.id);
  }

  const live = await stripe.subscriptions.retrieve(sub.processor_subscription_id);
  const item = live.items.data.find((i) => prices.centsOf(i.price?.id)) ?? null;
  const planCents = PLANS[sub.plan === "trial" ? "basic" : sub.plan].cents;
  // What is charged today: Stripe's own preview of the prorated difference. If this period's allowance was lowered
  // earlier in the period (Stripe already bills the lower amount next), it is first put back at no charge, so the
  // estimate is the prorated difference from what was paid.
  let chargeTodayCents = 0;
  if (raise) {
    if (billed === paid || paid === 0) {
      const preview = await stripe.invoices.createPreview({
        customer: sub.processor_customer_id ?? undefined, subscription: live.id,
        subscription_details: { items: [item ? { id: item.id, price: priceOf(amount) } : { price: priceOf(amount), quantity: 1 }], proration_behavior: "always_invoice" },
      });
      chargeTodayCents = preview.amount_due ?? 0;
    } else {
      const start = new Date(period!.period_start).getTime();
      const end = new Date(period!.period_end).getTime();
      chargeTodayCents = Math.ceil(((amount - paid) * Math.max(0, end - now.getTime())) / Math.max(1, end - start));
    }
  }
  const quote = {
    amountCents: amount as AddonCents, previousCents: billed, effect, chargeTodayCents,
    nextChargeCents: planCents + amount, nextChargeAt: trial ? sub.trial_ends_at : sub.renews_at,
    usableFrom: effect === "renewal" ? sub.renews_at : now.toISOString(),
    disclosure: amount > 0 ? addonRenewalLine(amount) : "No Mentor allowance from the next renewal. You won't be charged for it again.",
    termsVersion: MENTOR_ALLOWANCE_TERMS_VERSION,
  };
  // A quote changes nothing and records nothing. Confirming needs the terms agreed, in the version shown.
  if (body.confirm !== true) return { ok: true, body: { quote }, event: { action: A, result: "Completed", context: "" } };
  if (amount > 0 && (body.agreed !== true || body.termsVersion !== MENTOR_ALLOWANCE_TERMS_VERSION)) {
    return blocked(400, "Agree to the Mentor Allowance Terms first.", account.id);
  }
  if (body.expectedChargeCents !== chargeTodayCents) {
    return blocked(409, `The amount to pay today has changed to ${usd(chargeTodayCents)}. Nothing was charged. Review it and confirm again.`, account.id);
  }

  const consentId = amount > 0 ? await recordAddonConsent(beneficiary, account.id, terms.id) : null;
  const key = `ascentra-addon-${sub.id}-${args.requestId ?? now.getTime()}`;
  let updated: Stripe.Subscription;
  try {
    let current = item;
    if (raise && paid > 0 && billed !== paid) {
      // Put back what was paid for this period (no charge), then raise from there.
      const restored = await stripe.subscriptions.update(live.id, {
        items: [current ? { id: current.id, price: priceOf(paid) } : { price: priceOf(paid), quantity: 1 }], proration_behavior: "none",
      }, { idempotencyKey: `${key}-restore` });
      current = restored.items.data.find((i) => prices.centsOf(i.price?.id)) ?? null;
    }
    const items: Stripe.SubscriptionUpdateParams.Item[] = amount === 0
      ? (current ? [{ id: current.id, deleted: true }] : [])
      : [current ? { id: current.id, price: priceOf(amount) } : { price: priceOf(amount), quantity: 1 }];
    updated = await stripe.subscriptions.update(live.id, {
      items,
      proration_behavior: raise ? "always_invoice" : "none",
      ...(raise ? { payment_behavior: "error_if_incomplete" as const } : {}),
      metadata: { ...live.metadata, mentor_addon_cents: String(amount), ...(consentId ? { mentor_addon_consent_record_id: consentId } : {}) },
    }, { idempotencyKey: key });
  } catch (err) {
    const e = err as { type?: string; message?: string };
    console.error("[billing] Mentor allowance change failed:", e.message);
    if (e.type === "StripeCardError") {
      return blocked(402, "The payment for the higher Mentor allowance didn't go through, so nothing changed. Update your payment method in Manage billing, then try again.", account.id);
    }
    return blocked(502, "Stripe didn't accept the change, so nothing changed. Try again in a moment.", account.id);
  }
  // Written now, so the Mentor reads the new allowance on the very next message (the webhook repeats it, harmlessly).
  await applySubscription(updated, env, { eventId: `addon:${args.requestId ?? key}`, eventAt: new Date(), fresh: true });

  const name = forTeen ? await teenFirstName(beneficiary) : null;
  const when = effect === "now" ? "usable now" : effect === "renewal" ? "from the next renewal; this period keeps its allowance" : "first charged when the trial converts";
  return {
    ok: true,
    body: { mentorAddon: { amountCents: amount, effect, chargedTodayCents: chargeTodayCents } },
    event: {
      action: A, result: "Completed", sensitive: true, target: { type: "account", id: beneficiary },
      previous: addonLabel(billed), next: addonLabel(amount),
      reason: forTeen ? `Chosen by ${name}'s Guardian (the payer)` : "Chosen by the learner (the payer)",
      context: `${amount > 0 ? `Agreed to the Mentor Allowance Terms ${MENTOR_ALLOWANCE_TERMS_VERSION} and changed` : "Removed"} the Mentor allowance${name ? ` for ${name}` : ""}: ${addonLabel(billed)} → ${addonLabel(amount)}, ${when}${chargeTodayCents ? `; charged ${usd(chargeTodayCents)} today (prorated)` : "; nothing charged today"}.`,
    },
  };
}
