/**
 * Billing constants that never come from the client or from an admin: the plans, their prices, the
 * trial length, and the Automatic Renewal Terms shown before checkout. The terms text is stored,
 * word for word, as a published legal_document_versions row (db/migrations/0008_billing.sql); the
 * checkout route refuses if the stored text and this text differ, so what was agreed is what was shown.
 * Changing a price means a code change and a new Stripe price: no role in the app can do it.
 */

export type PaidPlan = "basic" | "pro";
export const PLANS: Record<PaidPlan, { name: string; cents: number }> = {
  basic: { name: "Basic", cents: 2000 },
  pro: { name: "Pro", cents: 5000 },
};
export const TRIAL_DAYS = 14;
export const CURRENCY = "usd";
/** US only (Stripe's two-letter country code). */
export const ALLOWED_COUNTRY = "US";

export const RENEWAL_TERMS_KEY = "automatic_renewal_terms";
export const RENEWAL_TERMS_VERSION = "v0.1";
export const RENEWAL_TERMS_TITLE = "Automatic Renewal Terms";
export const RENEWAL_TERMS_BODY =
  "ASCENTRA plans renew automatically every month until you cancel. Basic is $20.00 per month and Pro is " +
  "$50.00 per month, in US dollars. Your first subscription to Basic starts with a free 14-day trial: unless " +
  "you cancel before the trial ends, it converts to Basic and you are charged $20.00 when the trial ends, then " +
  "every month on that date. Pro is charged when you subscribe, then every month on that date. You can cancel " +
  "any time from the Billing section of your Account page. You keep access through the end of the trial or of " +
  "the period you paid for, and you are not charged again. ASCENTRA is available in the United States only.";
export const CONSENT_METHOD = "Separate recurring-billing checkbox before checkout";

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The one-line summary shown next to the checkbox, for the plan being bought. */
export function renewalSummary(plan: PaidPlan, trial: boolean, now = new Date()): string {
  const p = PLANS[plan];
  if (trial) {
    const end = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    return `I agree that after my free trial ends on ${end.toDateString()}, I'll be charged ${usd(p.cents)} every month until I cancel.`;
  }
  return `I agree that I'll be charged ${usd(p.cents)} today and every month after until I cancel.`;
}
