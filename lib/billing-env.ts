import "server-only";
import Stripe from "stripe";
import { z } from "zod";

/**
 * Stripe settings, read at request time. Deliberately not part of the startup environment (lib/env.ts):
 * a missing Stripe variable turns billing off (the billing routes answer 503) instead of taking the
 * whole site down. There are no defaults: every value comes from the host's environment.
 */
export const billingEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, "must be a Stripe secret key (sk_test_… in the sandbox)"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PRICE_BASIC: z.string().startsWith("price_"),
  STRIPE_PRICE_PRO: z.string().startsWith("price_"),
  STRIPE_PORTAL_CONFIG: z.string().startsWith("bpc_"),
});
export type BillingEnv = z.infer<typeof billingEnvSchema>;
export const BILLING_ENV_VARS = Object.keys(billingEnvSchema.shape) as (keyof BillingEnv)[];

export type BillingConfig = { ok: true; env: BillingEnv } | { ok: false; problems: string[] };

/** Validates the billing variables. Messages name variables, never their values. */
export function readBillingEnv(source: Record<string, string | undefined> = process.env): BillingConfig {
  const picked = Object.fromEntries(BILLING_ENV_VARS.map((k) => [k, source[k]?.trim() || undefined]));
  const r = billingEnvSchema.safeParse(picked);
  if (r.success) return { ok: true, env: r.data };
  return {
    ok: false,
    problems: r.error.issues.map((i) => {
      const name = String(i.path[0]);
      return picked[name] === undefined ? `${name} is missing` : `${name} is invalid (${i.message})`;
    }),
  };
}

/**
 * L5: the Mentor allowance add-on's three monthly prices ($5, $10, $20). Separate from the plan variables on purpose:
 * while any is missing, the add-on is off (it can't be chosen, and nothing about it is charged) and plans keep working.
 */
export const ADDON_PRICE_VARS = { 500: "STRIPE_PRICE_MENTOR_5", 1000: "STRIPE_PRICE_MENTOR_10", 2000: "STRIPE_PRICE_MENTOR_20" } as const;
export type AddonPrices = { ok: true; byCents: Record<500 | 1000 | 2000, string>; centsOf: (priceId: string | null | undefined) => 500 | 1000 | 2000 | null } | { ok: false; problems: string[] };

export function readAddonPrices(source: Record<string, string | undefined> = process.env): AddonPrices {
  const problems: string[] = [];
  const byCents = {} as Record<500 | 1000 | 2000, string>;
  for (const [cents, name] of Object.entries(ADDON_PRICE_VARS)) {
    const v = source[name]?.trim();
    if (!v) problems.push(`${name} is missing`);
    else if (!v.startsWith("price_")) problems.push(`${name} is invalid (must be a Stripe price id, price_…)`);
    else byCents[Number(cents) as 500 | 1000 | 2000] = v;
  }
  if (problems.length) return { ok: false, problems };
  const centsOf = (id: string | null | undefined) => {
    for (const [c, p] of Object.entries(byCents)) if (p === id) return Number(c) as 500 | 1000 | 2000;
    return null;
  };
  return { ok: true, byCents, centsOf };
}

export const BILLING_OFF = "Billing isn't set up yet. Nothing was charged. Try again later.";

export function billingUnavailable(problems: string[]): Response {
  console.error("[billing] not configured:", problems.join("; "));
  return Response.json({ error: "billing_unavailable", reason: BILLING_OFF }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export function stripeClient(env: BillingEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, appInfo: { name: "ASCENTRA" } });
}
