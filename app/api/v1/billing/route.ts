import { withCap } from "@/lib/auth";
import { readAddonPrices, readBillingEnv } from "@/lib/billing-env";
import { allowanceOf, meterLine } from "@/lib/mentor-allowance";
import {
  ADDON_CHOICES, ALLOWANCE_CONFIG, MENTOR_ALLOWANCE_TERMS_BODY, MENTOR_ALLOWANCE_TERMS_TITLE, MENTOR_ALLOWANCE_TERMS_VERSION,
} from "@/lib/mentor-allowance-terms";
import { LIVE_STATUSES, latestSubscription, tierOf, trialEligible } from "@/lib/billing";
import { PLANS, RENEWAL_TERMS_BODY, RENEWAL_TERMS_TITLE, RENEWAL_TERMS_VERSION, TRIAL_DAYS } from "@/lib/billing-terms";
import { ok } from "@/lib/http";

/**
 * Account → Plan and billing: what this account may use (read from the database now), its current
 * subscription, the plans and the Automatic Renewal Terms. No payment details: Stripe keeps them.
 */
export const GET = withCap("billing.view", async (_req, _ctx, account) => {
  const [{ tier, source }, sub, eligible, allowance] = await Promise.all([tierOf(account), latestSubscription(account.id), trialEligible(account.id), allowanceOf(account)]);
  const live = sub && LIVE_STATUSES.includes(sub.status) ? sub : null;
  const nextPlan = live?.plan === "trial" ? "basic" : live?.plan;
  return ok({
    configured: readBillingEnv().ok,
    // A teen's plan is chosen by their Guardian, in the Guardian Center.
    canSubscribe: account.roleKey === "learner" && !account.isMinor,
    // Only the payer manages or cancels a plan (a teen's Guardian, never the teen).
    canManage: !!live && live.payer_account_id === account.id,
    tier,
    source,
    subscription: live && {
      plan: live.plan,
      status: live.status,
      trialEndsAt: live.plan === "trial" ? live.trial_ends_at : null,
      nextChargeAt: live.status === "canceled" ? null : live.renews_at,
      nextChargeCents: live.status === "canceled" || !nextPlan ? null : PLANS[nextPlan].cents + (live.mentor_addon_cents ?? 0),
      accessUntil: live.status === "canceled" ? live.paid_through_at : null,
    },
    trialEligible: eligible,
    trialDays: TRIAL_DAYS,
    // The date the trial would end if it started now (shown next to the checkbox).
    trialWouldEndAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
    plans: Object.entries(PLANS).map(([key, p]) => ({ key, name: p.name, cents: p.cents })),
    terms: { title: RENEWAL_TERMS_TITLE, version: RENEWAL_TERMS_VERSION, body: RENEWAL_TERMS_BODY },
    // L5: the Mentor allowance add-on. The meter is read from the database now; only the payer changes the add-on.
    mentorAddon: {
      available: readAddonPrices().ok,
      canChange: !!live && live.payer_account_id === account.id && !account.isMinor && live.status !== "canceled",
      choices: ADDON_CHOICES,
      reservePercent: Math.round(ALLOWANCE_CONFIG.reserve * 100),
      trialAllowanceCents: ALLOWANCE_CONFIG.trialAllowanceCents,
      allowance: {
        status: allowance.status, addonCents: allowance.addonCents, nextAddonCents: allowance.nextAddonCents, usableUsd: allowance.usableUsd,
        usedUsd: allowance.usedUsd, resetsAt: allowance.resetsAt, trial: allowance.trial,
        line: allowance.status === "exempt" ? null : allowance.status === "none" ? "Mentor allowance: none" : meterLine(allowance),
      },
      terms: { title: MENTOR_ALLOWANCE_TERMS_TITLE, version: MENTOR_ALLOWANCE_TERMS_VERSION, body: MENTOR_ALLOWANCE_TERMS_BODY },
    },
  });
});
