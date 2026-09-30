import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { startCheckout } from "@/lib/billing-actions";
import { ok, refuse } from "@/lib/http";

/**
 * Basic or Pro through Stripe Checkout (Stripe's hosted page). Body: { plan, agreed: true,
 * termsVersion, usResident: true }. The agreement is stored before Stripe is contacted, and audited.
 */
export const POST = withCap("billing.subscribe", async (req, _ctx, account, x) => {
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const r = await startCheckout({ account, body: x.body, origin: new URL(req.url).origin, stripe: stripeClient(cfg.env), env: cfg.env });
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
