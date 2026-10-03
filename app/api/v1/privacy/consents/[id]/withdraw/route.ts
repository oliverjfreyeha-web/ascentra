import { withCap } from "@/lib/auth";
import { readBillingEnv, stripeClient } from "@/lib/billing-env";
import { ok, refuse } from "@/lib/http";
import { withdrawBillingConsent } from "@/lib/privacy";

/** Withdraw an optional consent (B4): recurring billing. The plan ends at the period end; a withdrawal row is added. */
export const POST = withCap("privacy.consent.withdraw", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const cfg = readBillingEnv();
  const r = await withdrawBillingConsent(account, id, cfg.ok ? stripeClient(cfg.env) : null);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
