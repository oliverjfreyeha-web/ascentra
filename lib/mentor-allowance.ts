import "server-only";
import { getDb } from "@/lib/db";
import type { RoleKey } from "@/lib/caps";
import { LIVE_STATUSES, latestSubscription, tierOf, type SubscriptionRow } from "@/lib/billing";
import { ALLOWANCE_CONFIG, choicesFor, testPriceScale, usableUsd, type AddonCents } from "@/lib/mentor-allowance-terms";
import { noticeMentorAllowance } from "@/lib/notices";

/**
 * L5: the Mentor allowance. Each billing period of a subscription has one mentor_allowance_periods row holding the add-on
 * paid for that period; each Mentor message adds a ledger row with its real cost (tokens × the model price table in
 * lib/ai/config.ts). The usable allowance is the add-on minus a reserve (lib/mentor-allowance-terms.ts, a placeholder).
 * A new period starts from zero: unused allowance doesn't carry over. Everything is read from the database on every
 * Mentor request; nothing a browser sends decides it.
 */
export type AllowancePeriod = {
  id: string; subscription_id: string; account_id: string; period_start: string; period_end: string; addon_cents: number; trial: boolean;
};

/**
 * Called whenever Stripe's view of a subscription is written. The period's add-on only goes up during the period: a
 * raise applies at once (it was paid for, prorated), a lower amount or a removal from the next period (Stripe bills the
 * lower amount from the next renewal, and the next period's row starts with it).
 */
export async function syncAllowancePeriod(row: SubscriptionRow, period: { start: string; end: string }, retried = false): Promise<void> {
  if (row.status === "ended") return;
  const db = getDb();
  const trial = row.plan === "trial";
  const found = (await db.from("mentor_allowance_periods").select("*").eq("subscription_id", row.id).eq("period_start", period.start).maybeSingle()).data as AllowancePeriod | null;
  if (found) {
    const addon = Math.max(found.addon_cents, row.mentor_addon_cents);
    if (addon === found.addon_cents && found.trial === trial && found.period_end === period.end) return;
    const { error } = await db.from("mentor_allowance_periods").update({ addon_cents: addon, trial, period_end: period.end }).eq("id", found.id);
    if (error) throw new Error(`allowance period update failed: ${error.message}`);
    return;
  }
  const { error } = await db.from("mentor_allowance_periods").insert({
    subscription_id: row.id, account_id: row.beneficiary_account_id, period_start: period.start, period_end: period.end,
    addon_cents: row.mentor_addon_cents, trial,
  });
  // 23505: a parallel delivery created this period first; apply this one as an update of it (once).
  if (error?.code === "23505" && !retried) return syncAllowancePeriod(row, period, true);
  if (error) throw new Error(`allowance period insert failed: ${error.message}`);
}

export type Allowance = {
  /** exempt: staff (access from the role, or the Owner); none: no add-on; active; used_up. */
  status: "exempt" | "none" | "active" | "used_up";
  addonCents: number;
  nextAddonCents: number;
  choices: readonly AddonCents[];
  usableUsd: number;
  usedUsd: number;
  resetsAt: string | null;
  trial: boolean;
  /** Only the payer changes the add-on: a teen's Guardian, never the teen. */
  payerAccountId: string | null;
  subscriptionId: string | null;
  periodId: string | null;
};

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** The account's allowance now: the live subscription, its current period, and what the ledger has counted. */
export async function allowanceOf(account: { id: string; roleKey: RoleKey }, now = new Date()): Promise<Allowance> {
  const base: Allowance = {
    status: "none", addonCents: 0, nextAddonCents: 0, choices: choicesFor("basic"), usableUsd: 0, usedUsd: 0, resetsAt: null, trial: false,
    payerAccountId: null, subscriptionId: null, periodId: null,
  };
  const { source } = await tierOf(account, now);
  if (source === "owner" || source === "role") return { ...base, status: "exempt", choices: [] };
  const sub = await latestSubscription(account.id);
  if (!sub || !LIVE_STATUSES.includes(sub.status)) return base;
  const db = getDb();
  const periods = ((await db.from("mentor_allowance_periods").select("*").eq("subscription_id", sub.id)
    .lte("period_start", now.toISOString()).gt("period_end", now.toISOString())
    .order("period_start", { ascending: false }).limit(1)).data ?? []) as AllowancePeriod[];
  const p = periods[0] ?? null;
  const common = { ...base, nextAddonCents: sub.mentor_addon_cents ?? 0, choices: choicesFor(sub.plan), payerAccountId: sub.payer_account_id, subscriptionId: sub.id };
  if (!p) return { ...common, resetsAt: sub.renews_at };
  const usable = usableUsd({ addonCents: p.addon_cents, trial: p.trial, plan: sub.plan });
  const rows = ((await db.from("mentor_allowance_usage").select("counted_usd").eq("period_id", p.id)).data ?? []) as { counted_usd: number | string }[];
  const used = round(rows.reduce((t, r) => t + (Number(r.counted_usd) || 0), 0));
  return {
    ...common, addonCents: p.addon_cents, usableUsd: usable, usedUsd: used, resetsAt: p.period_end, trial: p.trial, periodId: p.id,
    status: usable <= 0 ? "none" : used >= usable ? "used_up" : "active",
  };
}

/**
 * One Mentor message's cost, added to the ledger: the real cost, and what counts against the allowance (the same, or
 * scaled up on a Preview test; see testPriceScale). Teens: the Guardian is emailed at 80% and at 100%.
 */
export async function recordMentorUsage(a: Allowance, who: { accountId: string; isMinor: boolean; requestId?: string | null }, costUsd: number): Promise<void> {
  if (!a.periodId || a.status === "exempt") return;
  const scale = testPriceScale();
  const counted = round(costUsd * scale);
  const { error } = await getDb().from("mentor_allowance_usage").insert({
    period_id: a.periodId, account_id: who.accountId, request_id: who.requestId ?? null, cost_usd: round(costUsd), counted_usd: counted, price_scale: scale,
  });
  if (error) throw new Error(`allowance usage insert failed: ${error.message}`);
  if (!who.isMinor || a.usableUsd <= 0 || !a.subscriptionId) return;
  const used = round(a.usedUsd + counted);
  const crossed = ALLOWANCE_CONFIG.guardianNotices.filter((t) => used >= a.usableUsd * t);
  if (!crossed.length) return;
  const sub = (await getDb().from("subscriptions").select("*").eq("id", a.subscriptionId).maybeSingle()).data as SubscriptionRow | null;
  if (!sub || sub.payer_account_id === sub.beneficiary_account_id) return;
  // The highest threshold reached is the one that matters; each goes out once per period (the notice's dedupe key).
  for (const t of crossed) await noticeMentorAllowance(sub, a.periodId, t >= 1 ? 100 : 80, used, a.usableUsd, a.resetsAt);
}

/** The meter's one line: "Mentor allowance: used X of Y, resets on DATE". */
export function meterLine(a: Pick<Allowance, "usedUsd" | "usableUsd" | "resetsAt">): string {
  const day = a.resetsAt ? new Date(a.resetsAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "your next renewal";
  return `Mentor allowance: used $${Math.min(a.usedUsd, a.usableUsd).toFixed(2)} of $${a.usableUsd.toFixed(2)}, resets on ${day}`;
}
