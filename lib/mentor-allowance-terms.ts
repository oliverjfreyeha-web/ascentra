/**
 * L5: the Mentor allowance add-on, as constants that never come from the client or from an admin. The add-on is a
 * prepaid monthly item on the same Stripe subscription as the plan. The terms text is stored word for word as a
 * published legal_document_versions row (db/migrations/0016_mentor_allowance.sql); the server refuses to add the
 * add-on if the stored text and this text differ, so what was agreed is what was shown.
 * Changing an amount means a code change and a new Stripe price: no role in the app can do it.
 */
import type { PaidPlan } from "./billing-terms";

export type AddonCents = 0 | 500 | 1000 | 2000;
export const ADDON_AMOUNTS = [500, 1000, 2000] as const;
/** The choices per plan (the trial converts to Basic, so it has Basic's choices). */
export const ADDON_CHOICES: Record<PaidPlan, readonly AddonCents[]> = { basic: [0, 500, 1000], pro: [0, 1000, 2000] };
export const choicesFor = (plan: "trial" | PaidPlan): readonly AddonCents[] => ADDON_CHOICES[plan === "trial" ? "basic" : plan];
export const isAllowedChoice = (plan: "trial" | PaidPlan, cents: unknown): cents is AddonCents =>
  typeof cents === "number" && choicesFor(plan).includes(cents as AddonCents);

/**
 * PLACEHOLDERS (Owner decisions; change here with a code review and a deploy):
 *   reserve: the share of each month's add-on kept for running costs; the rest is the usable allowance.
 *   trialAllowanceCents: what a learner with the add-on may use during a free trial (the add-on is first charged
 *     when the trial converts). 0 turns it off.
 *   rollover: unused allowance does not carry over to the next period.
 *   guardianNotices: the shares of a teen's allowance at which the Guardian is emailed.
 */
export const ALLOWANCE_CONFIG = { reserve: 0.3, trialAllowanceCents: 100, rollover: false, guardianNotices: [0.8, 1] } as const;
export const ALLOWANCE_IS_PLACEHOLDER = true;

/** The usable allowance in US dollars for a period: the add-on minus the reserve (or the trial allowance). */
export function usableUsd(p: { addonCents: number; trial: boolean; plan: "trial" | PaidPlan }): number {
  if (p.addonCents <= 0) return 0;
  if (p.trial) return ALLOWANCE_CONFIG.trialAllowanceCents / 100;
  // A plan change can leave an add-on above what the plan offers (Pro $20, then Basic): only the plan's top amount counts.
  const top = Math.max(...choicesFor(p.plan));
  return Math.round(Math.min(p.addonCents, top) * (1 - ALLOWANCE_CONFIG.reserve)) / 100;
}

export const MENTOR_ALLOWANCE_TERMS_KEY = "mentor_allowance_terms";
export const MENTOR_ALLOWANCE_TERMS_VERSION = "v0.1";
export const MENTOR_ALLOWANCE_TERMS_TITLE = "Mentor Allowance Terms";
export const MENTOR_ALLOWANCE_TERMS_BODY =
  "The Mentor allowance is an optional add-on to an ASCENTRA plan that pays for the Mentor's AI use. It is prepaid: " +
  "$5.00, $10.00 or $20.00 per month in US dollars (Basic: $5.00 or $10.00; Pro: $10.00 or $20.00), charged with your " +
  "plan on the same date. It renews automatically every month with your plan until you remove it or cancel the plan. " +
  "Raising it takes effect right away, and you're charged the prorated difference for the rest of the current period, " +
  "shown before you confirm. Lowering or removing it takes effect at your next renewal; there is no refund for the " +
  "current period. Part of each month's amount covers running costs, so the usable allowance shown on your meter is " +
  "less than the amount charged. It resets at each renewal, and unused allowance doesn't carry over. When it runs out, " +
  "the Mentor pauses until it resets or you raise it; you're never charged more than the amount you chose. During a " +
  "free trial, the add-on is first charged when the trial converts. A teen's allowance is chosen and paid for by their Guardian.";
export const ADDON_CONSENT_METHOD = "Separate Mentor allowance checkbox before the add-on is added";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The automatic-renewal line for the add-on, shown next to its checkbox and on Stripe's page. */
export function addonRenewalLine(cents: number): string {
  return `Mentor allowance: ${usd(cents)} per month, renewing automatically with my plan until I remove it.`;
}

/**
 * L5: a Preview-only test setting. MENTOR_TEST_PRICE_SCALE multiplies what each Mentor message counts against the
 * allowance, so a test allowance runs out after a few messages without spending real money. It is read ONLY when
 * Vercel says this deployment is a Preview (VERCEL_ENV=preview); in Production, in Development and anywhere else it is
 * ignored and the scale is 1. The real cost is always recorded alongside.
 */
export function testPriceScale(env: Record<string, string | undefined> = process.env): number {
  if (env.VERCEL_ENV !== "preview") return 1;
  const n = Number(env.MENTOR_TEST_PRICE_SCALE);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n * 100) / 100, 10_000) : 1;
}
