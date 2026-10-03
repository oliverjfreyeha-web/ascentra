import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { startIdentity } from "@/lib/guardians";
import { ok, refuse } from "@/lib/http";

// Starts Stripe Identity's hosted check (ID document, selfie, adult status). The result arrives by webhook.
export const POST = withCap("guardian.identity.verify", async (req, _ctx, account, x) => {
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const r = await startIdentity(account, stripeClient(cfg.env), new URL(req.url).origin);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
