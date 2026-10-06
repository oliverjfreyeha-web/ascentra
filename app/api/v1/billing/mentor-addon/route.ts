import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { changeAddon } from "@/lib/mentor-addon";
import { ok, refuse } from "@/lib/http";

/**
 * L5: choose, change or remove the Mentor allowance add-on (the payer only: a learner, or a teen's Guardian).
 * Body: { amountCents, agreed, termsVersion, teenAccountId?, confirm?, expectedChargeCents? }. Without confirm it only
 * quotes (nothing changes, nothing is recorded); with confirm it must carry the quoted charge. Audited with the previous
 * and the new amount, the reason and the result.
 */
export const POST = withCap("billing.subscribe", async (_req, _ctx, account, x) => {
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const r = await changeAddon({ account, body: x.body, stripe: stripeClient(cfg.env), env: cfg.env, requestId: x.requestId });
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
