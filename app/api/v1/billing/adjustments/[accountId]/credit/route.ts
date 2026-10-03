import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { credit } from "@/lib/billing-adjustments";
import { ok, refuse } from "@/lib/http";

/** Owner only (B4): a credit taken off the account's next invoices. Body: { amountCents, reason }. */
export const POST = withCap("billing.credit", async (_req, ctx, account, x) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const r = await credit(account, accountId, x.body, x.reason!, stripeClient(cfg.env), x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
