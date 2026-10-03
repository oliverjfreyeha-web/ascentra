import { withCap } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ok } from "@/lib/http";
import type { SubscriptionRow } from "@/lib/billing";

/**
 * The site-wide billing banner (B4). For the payer: a failed payment that Stripe is retrying, per plan (a Guardian
 * sees one per teen). For a teen whose Guardian pays: the same problem, and that the Guardian has been told.
 * Device check "any": the banner is shown before a device is trusted, too.
 */
export const GET = withCap("billing.view", async (_req, _ctx, account) => {
  const db = getDb();
  const [paying, using] = await Promise.all([
    db.from("subscriptions").select("*").eq("payer_account_id", account.id).eq("status", "past_due"),
    db.from("subscriptions").select("*").eq("beneficiary_account_id", account.id).eq("status", "past_due"),
  ]);
  const alerts: { kind: "payment_failed"; forAccountId: string; message: string; href: string }[] = [];
  const names = async (id: string) =>
    ((await db.from("profiles").select("display_name").eq("account_id", id).maybeSingle()).data as { display_name: string } | null)?.display_name.split(/\s+/)[0] ?? "your teen";
  for (const s of (paying.data ?? []) as SubscriptionRow[]) {
    const teen = s.beneficiary_account_id !== account.id;
    alerts.push({
      kind: "payment_failed", forAccountId: s.beneficiary_account_id, href: teen ? "/guardian" : "/account",
      message: `The payment for ${teen ? `${await names(s.beneficiary_account_id)}'s` : "your"} plan failed. Stripe will try again; access continues meanwhile. Update the payment method in Manage billing.`,
    });
  }
  for (const s of (using.data ?? []) as SubscriptionRow[]) {
    if (s.payer_account_id === account.id) continue;
    alerts.push({ kind: "payment_failed", forAccountId: account.id, href: "/account", message: "There's a problem with the payment for your plan. Your Guardian has been told. You keep access while it's fixed." });
  }
  return ok({ alerts });
}, { device: "any", allowSuspended: true });
