import { withCap } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ok } from "@/lib/http";
import { LIVE_STATUSES, type SubscriptionRow } from "@/lib/billing";

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
  const alerts: { kind: "payment_failed" | "mentor_allowance"; forAccountId: string; message: string; href: string }[] = [];
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
  // L5: a teen's Mentor allowance email (80% or 100%) that couldn't be sent (email not configured, or it failed) is
  // shown to the Guardian here instead, for the current period.
  const now = new Date().toISOString();
  const teenPlans = ((await db.from("subscriptions").select("*").eq("payer_account_id", account.id)).data ?? []) as SubscriptionRow[];
  for (const s of teenPlans) {
    if (s.beneficiary_account_id === account.id || !LIVE_STATUSES.includes(s.status)) continue;
    const period = (((await db.from("mentor_allowance_periods").select("id").eq("subscription_id", s.id).lte("period_start", now).gt("period_end", now).limit(1)).data ?? []) as { id: string }[])[0];
    if (!period) continue;
    const missed = ((await db.from("notices").select("kind, status").in("dedupe_key", [`mentor_allowance_100:${period.id}`, `mentor_allowance_80:${period.id}`])).data ?? []) as { kind: string; status: string }[];
    const unsent = missed.filter((n) => n.status === "skipped" || n.status === "failed").map((n) => n.kind);
    if (!unsent.length) continue;
    const name = await names(s.beneficiary_account_id);
    alerts.push({
      kind: "mentor_allowance", forAccountId: s.beneficiary_account_id, href: "/guardian",
      message: unsent.includes("mentor_allowance_100")
        ? `${name} has used all of this period's Mentor allowance, so the Mentor is paused for them until it resets. Only you can raise it.`
        : `${name} has used 80% of this period's Mentor allowance.`,
    });
  }
  return ok({ alerts });
}, { device: "any", allowSuspended: true });
