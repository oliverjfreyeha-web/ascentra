import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { openPortal } from "@/lib/billing-actions";
import { ok, refuse } from "@/lib/http";

/**
 * Stripe's customer portal: cancel, change between Basic and Pro, update the payment method.
 * Sensitive: Clerk re-checks the second factor first (withCap). The changes come back by webhook.
 */
export const POST = withCap("billing.portal", async (req, _ctx, account, x) => {
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const r = await openPortal({ account, origin: new URL(req.url).origin, stripe: stripeClient(cfg.env), env: cfg.env });
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
