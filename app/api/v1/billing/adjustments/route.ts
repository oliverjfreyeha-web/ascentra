import { withCap } from "@/lib/auth";
import { billingUnavailable, readBillingEnv, stripeClient } from "@/lib/billing-env";
import { lookupForAdjustments } from "@/lib/billing-adjustments";
import { ok, refuse } from "@/lib/http";

// Owner only (B4): an account's recent charges and credit balance, before a refund or credit. ?q=<email or account id>
export const GET = withCap("billing.adjustments.view", async (req) => {
  const cfg = readBillingEnv();
  if (!cfg.ok) return billingUnavailable(cfg.problems);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const r = await lookupForAdjustments(q, stripeClient(cfg.env));
  return r ? ok(r) : refuse(404, "No account with that email or id.");
});
