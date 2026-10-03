import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { startCancel } from "@/lib/billing-actions";
import { ok, refuse } from "@/lib/http";

/** Cancel plan (B4): straight to Stripe's cancellation confirmation. Body: { teenAccountId? } for a Guardian. */
export const POST = withCap("billing.cancel", async (req, _ctx, account, x) => {
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const r = await startCancel({ account, body: x.body, origin: new URL(req.url).origin, stripe: stripeClient(cfg.env), env: cfg.env });
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
