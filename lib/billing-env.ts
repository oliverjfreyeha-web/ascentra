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

export const BILLING_OFF = "Billing isn't set up yet. Nothing was charged. Try again later.";

export function billingUnavailable(problems: string[]): Response {
  console.error("[billing] not configured:", problems.join("; "));
  return Response.json({ error: "billing_unavailable", reason: BILLING_OFF }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export function stripeClient(env: BillingEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, appInfo: { name: "ASCENTRA" } });
}
