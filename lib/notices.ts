import "server-only";
import { getDb } from "@/lib/db";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { readEmailEnv, sendEmail } from "@/lib/email";
import { NOTICE_TIMINGS } from "@/lib/notice-config";
import { PLANS, usd } from "@/lib/billing-terms";
import type { SubscriptionRow } from "@/lib/billing";

/**
 * B4: email notices (Resend). Each notice is one notices row, keyed so it goes out once however often a webhook or
 * the daily job sees the same moment. A failed or skipped notice is tried again the next time the same moment is
 * seen. The text is built here and never stored. Recipients are the payer (customer of record): for a teen's plan,
 * the Guardian.
 */
export type NoticeKind =
  | "trial_ending" | "renewal_upcoming" | "payment_failed" | "subscription_canceled" | "subscription_ended" | "guardian_consent_withdrawn"
  | "mentor_allowance_80" | "mentor_allowance_100";
export type NoticeOutcome = "sent" | "skipped" | "failed" | "duplicate";

type Person = { id: string; email: string };
type NoticeInput = { kind: NoticeKind; to: Person; aboutId?: string | null; subscriptionId?: string | null; dedupeKey: string; subject: string; text: string };

const ACTOR = SYSTEM_ACTOR("Notices");
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "the end of the period";

/** The site's address for links in emails (Vercel sets the production host), or null. */
function siteUrl(): string | null {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : null;
}
const where = (path: string, label: string) => {
  const url = siteUrl();
  return url ? `${label}: ${url}${path}` : `${label} in ASCENTRA.`;
};

export async function notify(n: NoticeInput): Promise<NoticeOutcome> {
  const db = getDb();
  const { data: inserted, error } = await db.from("notices").insert({
    account_id: n.to.id, about_account_id: n.aboutId ?? null, subscription_id: n.subscriptionId ?? null,
    kind: n.kind, dedupe_key: n.dedupeKey, status: "queued",
  }).select("id, status").single();
  let row = inserted as { id: string; status: string } | null;
  if (error?.code === "23505") {
    row = (await db.from("notices").select("id, status").eq("dedupe_key", n.dedupeKey).maybeSingle()).data as { id: string; status: string } | null;
    // Sent (or being sent) already: nothing to do. Skipped or failed: try again now.
    if (!row || row.status === "sent" || row.status === "queued") return "duplicate";
  } else if (error) {
    throw new Error(`notice insert failed: ${error.message}`);
  }
  const cfg = readEmailEnv();
  let outcome: NoticeOutcome;
  let update: Record<string, unknown>;
  if (!cfg.ok) {
    outcome = "skipped";
    update = { status: "skipped", error: `email isn't configured: ${cfg.problems.join("; ")}` };
  } else {
    const r = await sendEmail(cfg.env, { to: n.to.email, subject: n.subject, text: n.text, idempotencyKey: n.dedupeKey });
    outcome = r.ok ? "sent" : "failed";
    update = r.ok ? { status: "sent", sent_at: new Date().toISOString(), provider_message_id: r.id, error: null } : { status: "failed", error: r.error.slice(0, 500) };
    if (!r.ok) console.error(`[notices] ${n.kind} email failed:`, r.error);
  }
  const { error: upErr } = await db.from("notices").update(update).eq("id", row!.id);
  if (upErr) throw new Error(`notice update failed: ${upErr.message}`);
  await recordAudit({
    actor: ACTOR, action: `notice.${n.kind}`, result: outcome === "sent" ? "Completed" : "Blocked",
    status: outcome === "sent" ? "Recorded" : outcome === "skipped" ? "Not sent (email not configured)" : "Not sent (will retry)",
    context: `${outcome === "sent" ? "Emailed" : "Could not email"} ${n.to.email}: ${n.subject}`,
    target: { type: "account", id: n.to.id, label: n.to.email },
  });
  return outcome;
}

// ============ Who and what ============

async function person(id: string): Promise<(Person & { name: string; isMinor: boolean }) | null> {
  const db = getDb();
  const a = (await db.from("accounts").select("id, email, is_minor").eq("id", id).maybeSingle()).data as { id: string; email: string; is_minor: boolean } | null;
  if (!a) return null;
  const p = (await db.from("profiles").select("display_name").eq("account_id", id).maybeSingle()).data as { display_name: string } | null;
  return { id: a.id, email: a.email, isMinor: !!a.is_minor, name: (p?.display_name ?? a.email).split(/\s+/)[0] };
}

/** The payer, and the teen when the payer is a Guardian paying for one. */
async function partiesOf(sub: SubscriptionRow) {
  const payer = await person(sub.payer_account_id);
  const teen = sub.beneficiary_account_id !== sub.payer_account_id ? await person(sub.beneficiary_account_id) : null;
  return { payer, teen, whose: teen ? `${teen.name}'s` : "your" };
}

const planName = (sub: SubscriptionRow) => (sub.plan === "trial" ? "Basic (free trial)" : PLANS[sub.plan].name);

export async function noticeTrialEnding(sub: SubscriptionRow) {
  const { payer, whose } = await partiesOf(sub);
  if (!payer || !sub.trial_ends_at) return null;
  return notify({
    kind: "trial_ending", to: payer, aboutId: sub.beneficiary_account_id, subscriptionId: sub.id,
    dedupeKey: `trial_ending:${sub.id}:${sub.trial_ends_at}`,
    subject: `${whose === "your" ? "Your" : whose} ASCENTRA free trial ends on ${day(sub.trial_ends_at)}`,
    text: `${whose === "your" ? "Your" : whose} free trial of ASCENTRA ends on ${day(sub.trial_ends_at)}. Unless you cancel before then, it converts to Basic and you are charged ${usd(PLANS.basic.cents)} on that date, then every month until you cancel.\n\nTo cancel, open Plan and billing and choose Cancel plan. ${where("/account", "Plan and billing")}`,
  });
}

export async function noticeRenewal(sub: SubscriptionRow) {
  const { payer, whose } = await partiesOf(sub);
  if (!payer || !sub.renews_at || sub.plan === "trial") return null;
  return notify({
    kind: "renewal_upcoming", to: payer, aboutId: sub.beneficiary_account_id, subscriptionId: sub.id,
    dedupeKey: `renewal_upcoming:${sub.id}:${sub.renews_at}`,
    subject: `${whose === "your" ? "Your" : whose} ASCENTRA plan renews on ${day(sub.renews_at)}`,
    text: `${whose === "your" ? "Your" : whose} ${planName(sub)} plan renews on ${day(sub.renews_at)} for ${usd(PLANS[sub.plan].cents)}, charged to the card on file. It renews every month until you cancel.\n\nTo cancel, open Plan and billing and choose Cancel plan. ${where("/account", "Plan and billing")}`,
  });
}

export async function noticePaymentFailed(sub: SubscriptionRow, invoiceId: string, amountCents: number) {
  const { payer, teen, whose } = await partiesOf(sub);
  if (!payer) return null;
  return notify({
    kind: "payment_failed", to: payer, aboutId: sub.beneficiary_account_id, subscriptionId: sub.id, dedupeKey: `payment_failed:${invoiceId}`,
    subject: `Payment failed for ${whose} ASCENTRA plan`,
    text: `We couldn't take the payment of ${usd(amountCents)} for ${whose} ASCENTRA plan. Stripe will try again over the next few days, and ${teen ? `${teen.name} keeps` : "you keep"} access while it does. If every attempt fails, the plan ends${teen ? ` and ${teen.name}'s access to paid features stops` : ""}.\n\nPlease update the payment method: open Plan and billing and choose Manage billing. ${where(teen ? "/guardian" : "/account", "Plan and billing")}`,
  });
}

export async function noticeCanceled(sub: SubscriptionRow) {
  const { payer, teen, whose } = await partiesOf(sub);
  if (!payer) return null;
  return notify({
    kind: "subscription_canceled", to: payer, aboutId: sub.beneficiary_account_id, subscriptionId: sub.id,
    dedupeKey: `subscription_canceled:${sub.id}:${sub.paid_through_at ?? ""}`,
    subject: `${whose === "your" ? "Your" : whose} ASCENTRA plan is canceled`,
    text: `${whose === "your" ? "Your" : whose} ${planName(sub)} plan is canceled. ${teen ? `${teen.name} keeps` : "You keep"} access until ${day(sub.paid_through_at)}, and you won't be charged again.\n\nChanged your mind? You can renew it from Manage billing before then. ${where(teen ? "/guardian" : "/account", "Plan and billing")}`,
  });
}

export async function noticeEnded(sub: SubscriptionRow) {
  const { payer, teen, whose } = await partiesOf(sub);
  if (!payer) return null;
  return notify({
    kind: "subscription_ended", to: payer, aboutId: sub.beneficiary_account_id, subscriptionId: sub.id, dedupeKey: `subscription_ended:${sub.id}`,
    subject: `${whose === "your" ? "Your" : whose} ASCENTRA plan has ended`,
    text: `${whose === "your" ? "Your" : whose} ASCENTRA plan has ended${sub.processor_status === "canceled" ? "" : " because the payment didn't go through"}. ${teen ? `${teen.name}'s account stays, with progress kept, but paid features are off` : "Your account stays, with progress kept, but paid features are off"} until a new plan starts. You won't be charged.\n\n${where(teen ? "/guardian" : "/account", "Choose a plan")}`,
  });
}

/** B3's withdrawal, told to both by email (they also see it in the app). */
export async function noticeConsentWithdrawn(guardianId: string, teenId: string, withdrawnAt: string) {
  const [guardian, teen] = [await person(guardianId), await person(teenId)];
  if (!guardian || !teen) return [];
  return [
    await notify({
      kind: "guardian_consent_withdrawn", to: guardian, aboutId: teen.id, dedupeKey: `guardian_consent_withdrawn:${teen.id}:${withdrawnAt}:guardian`,
      subject: `You withdrew consent for ${teen.name}'s ASCENTRA account`,
      text: `You withdrew your consent for ${teen.name} on ${day(withdrawnAt)}. ${teen.name}'s account is paused, not deleted: progress is kept. The plan ends at the end of the current period, with no further charges.\n\n${where("/guardian", "Guardian Center")}`,
    }),
    await notify({
      kind: "guardian_consent_withdrawn", to: teen, aboutId: teen.id, dedupeKey: `guardian_consent_withdrawn:${teen.id}:${withdrawnAt}:teen`,
      subject: "Your ASCENTRA account is paused",
      text: `Your Guardian withdrew their consent on ${day(withdrawnAt)}, so your ASCENTRA account is paused. Nothing was deleted: your progress is kept. Only your Guardian can give consent again.`,
    }),
  ];
}

/**
 * L5: the Guardian is told when their teen has used 80% and 100% of the Mentor allowance for the period. Once each per
 * period (the dedupe key). If email isn't configured, the notice is recorded as skipped and the Guardian sees a banner.
 * Amounts only: never what the teen asked the Mentor.
 */
export async function noticeMentorAllowance(sub: SubscriptionRow, periodId: string, pct: 80 | 100, usedUsd: number, usableUsd: number, resetsAt: string | null) {
  const { payer, teen } = await partiesOf(sub);
  if (!payer || !teen) return null;
  const amounts = `$${Math.min(usedUsd, usableUsd).toFixed(2)} of $${usableUsd.toFixed(2)}`;
  return notify({
    kind: pct === 100 ? "mentor_allowance_100" : "mentor_allowance_80", to: payer, aboutId: teen.id, subscriptionId: sub.id,
    dedupeKey: `mentor_allowance_${pct}:${periodId}`,
    subject: pct === 100 ? `${teen.name}'s Mentor allowance is used up` : `${teen.name} has used 80% of their Mentor allowance`,
    text: pct === 100
      ? `${teen.name} has used all of this period's Mentor allowance (${amounts}). The Mentor is paused for ${teen.name} until it resets on ${day(resetsAt)}, unless you raise it. Lessons work as usual. You won't be charged anything unless you choose a higher allowance.\n\nOnly you can change it: ${where("/guardian", "Guardian Center")}`
      : `${teen.name} has used ${amounts} of this period's Mentor allowance. It resets on ${day(resetsAt)}. Nothing changes unless you choose a higher allowance.\n\n${where("/guardian", "Guardian Center")}`,
  });
}

/**
 * A teen never loses access without their Guardian being told first: before a teen's plan is recorded as ended,
 * the Guardian is emailed (or, if email isn't configured, the notice is recorded and shown as a banner).
 */
export async function tellGuardianBeforeTeenLosesAccess(sub: SubscriptionRow): Promise<NoticeOutcome | null> {
  if (sub.beneficiary_account_id === sub.payer_account_id) return null;
  return noticeEnded(sub);
}

// ============ The daily job ============

/** Trial-ending and renewal reminders due now (timings in lib/notice-config.ts, placeholders). */
export async function sendScheduledNotices(now = new Date()) {
  const db = getDb();
  const within = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const { data: trials, error: tErr } = await db.from("subscriptions").select("*").eq("status", "trialing")
    .gte("trial_ends_at", now.toISOString()).lte("trial_ends_at", within(NOTICE_TIMINGS.trialEndingDaysBefore));
  if (tErr) throw new Error(`trial lookup failed: ${tErr.message}`);
  const { data: renewals, error: rErr } = await db.from("subscriptions").select("*").eq("status", "active")
    .gte("renews_at", now.toISOString()).lte("renews_at", within(NOTICE_TIMINGS.renewalReminderDaysBefore));
  if (rErr) throw new Error(`renewal lookup failed: ${rErr.message}`);
  const counts: Record<string, number> = {};
  const tally = (o: NoticeOutcome | null) => o && (counts[o] = (counts[o] ?? 0) + 1);
  for (const s of (trials ?? []) as SubscriptionRow[]) tally(await noticeTrialEnding(s));
  for (const s of (renewals ?? []) as SubscriptionRow[]) tally(await noticeRenewal(s));
  return counts;
}
