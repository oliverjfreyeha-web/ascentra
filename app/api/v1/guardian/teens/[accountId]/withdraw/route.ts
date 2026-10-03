import { withCap } from "@/lib/auth";
import { readBillingEnv, stripeClient } from "@/lib/billing-env";
import { withdrawConsent } from "@/lib/guardians";
import { ok, refuse } from "@/lib/http";

/**
 * The Guardian withdraws consent for a teen. Body: { reason }. The teen is paused (nothing is deleted) and the plan
 * ends at the end of the period, with no further charges.
 */
export const POST = withCap("guardian.consent.withdraw", async (_req, ctx, account, x) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const cfg = readBillingEnv();
  const r = await withdrawConsent(account, accountId, x.reason!, cfg.ok ? stripeClient(cfg.env) : null);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
