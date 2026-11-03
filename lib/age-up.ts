import "server-only";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { recordAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { ageOn, usToday, type Ymd } from "@/lib/age";
import { LIVE_STATUSES, latestSubscription } from "@/lib/billing";
import { noticeTurned18, noticeTurning18 } from "@/lib/notices";
import { AGE_UP_WARNING_DAYS, adultOn, pickWarning, type WarningWindow } from "@/lib/age-up-rules";

/**
 * S2: the 18th-birthday switch, run once a day (app/api/cron/age-up). For each active teen:
 *   - 30 and 7 days before they turn 18, the learner and the Guardian are emailed once each (a warning is sent at most
 *     once per window however often the job runs);
 *   - on the day, public.age_up_account turns the teen into an adult learner and ends the Guardian link;
 *   - a Guardian-paid plan is set to end at the period end (no further charges), and both are told. The new adult
 *     chooses their own plan and agrees to the renewal terms themselves.
 * A teen who is pending or paused is not switched; the run records it so a person can look.
 * Courses hidden from teens show for the learner as soon as is_minor is false. The adult agreements are recorded as
 * due (accounts.adult_agreement_due) but not enforced yet; see docs/AGE-UP.md.
 */
const ACTOR = SYSTEM_ACTOR("18th-birthday switch");

export type AgeUpSummary = {
  checked: number;
  warned: Record<string, number>;
  agedUp: number;
  held: number;
  planEndsSet: number;
  problems: number;
};

export { AGE_UP_WARNING_DAYS, pickWarning };

async function guardianOf(teenId: string): Promise<string | null> {
  const { data, error } = await getDb().from("guardian_relationships").select("guardian_account_id")
    .eq("teen_account_id", teenId).is("withdrawn_at", null).neq("verification_status", "failed").maybeSingle();
  if (error) throw new Error(`guardian lookup failed: ${error.message}`);
  return (data as { guardian_account_id: string | null } | null)?.guardian_account_id ?? null;
}

/** The Guardian's plan for this teen, set to end at the period end. Returns true if it was changed. */
async function endGuardianPlan(teenId: string, guardianId: string | null, stripe: Stripe | null): Promise<boolean | "failed"> {
  const sub = await latestSubscription(teenId);
  if (!sub || !LIVE_STATUSES.includes(sub.status) || sub.payer_account_id === teenId || sub.cancel_at_period_end) return false;
  if (guardianId && sub.payer_account_id !== guardianId) return false;
  if (!sub.processor_subscription_id) return false;
  if (!stripe) return "failed";
  try {
    await stripe.subscriptions.update(sub.processor_subscription_id, { cancel_at_period_end: true });
    return true;
  } catch (err) {
    console.error("[age-up] cancel at period end failed:", err instanceof Error ? err.message : err);
    return "failed";
  }
}

export async function runAgeUp(stripe: Stripe | null, now = new Date()): Promise<AgeUpSummary> {
  const db = getDb();
  const today: Ymd = usToday(now);
  const summary: AgeUpSummary = { checked: 0, warned: {}, agedUp: 0, held: 0, planEndsSet: 0, problems: 0 };
  const { data, error } = await db.rpc("age_up_candidates");
  if (error) throw new Error(`age-up lookup failed: ${error.message}`);
  const rows = (data ?? []) as { account_id: string; date_of_birth: string }[];
  summary.checked = rows.length;

  for (const r of rows) {
    try {
      const [y, m, d] = r.date_of_birth.split("-").map(Number);
      const dob: Ymd = { y, m, d };
      if (ageOn(dob, today) >= 18) {
        // The day has come (or the job missed a day): switch, then deal with the plan and tell both.
        const guardianId = await guardianOf(r.account_id);
        const { data: res, error: rpcErr } = await db.rpc("age_up_account", { p_account: r.account_id });
        if (rpcErr) throw new Error(`age-up failed: ${rpcErr.message}`);
        if (res === "held_status") {
          summary.held++;
          await recordAudit({
            actor: ACTOR, action: "accounts.age_up.held", result: "Blocked", sensitive: true, target: { type: "account", id: r.account_id },
            context: "A teen turned 18 but their account is pending or paused, so it was not switched to an adult account. A person needs to look at it.",
            status: "Needs a person",
          });
          continue;
        }
        if (res !== "aged_up") continue;
        summary.agedUp++;
        const plan = await endGuardianPlan(r.account_id, guardianId, stripe);
        if (plan === true) summary.planEndsSet++;
        if (plan === "failed") summary.problems++;
        await recordAudit({
          actor: ACTOR, action: "accounts.age_up", result: "Completed", sensitive: true, target: { type: "account", id: r.account_id },
          previous: "teen learner", next: "adult learner",
          context: `Turned 18: now an adult learner, the Guardian link is closed. ${plan === true ? "The Guardian's plan is set to end at the period end." : plan === "failed" ? "The Guardian's plan could NOT be set to end (Stripe or billing was unavailable); a person must check it." : "There was no Guardian plan to end."}`,
          status: plan === "failed" ? "Needs a person" : "Recorded",
        });
        await noticeTurned18(r.account_id, guardianId, plan === true);
        continue;
      }
      const window = pickWarning(dob, today);
      if (!window) continue;
      const guardianId = await guardianOf(r.account_id);
      await noticeTurning18(r.account_id, guardianId, window, adultOn(dob, today) ?? r.date_of_birth);
      summary.warned[window] = (summary.warned[window] ?? 0) + 1;
    } catch (err) {
      summary.problems++;
      console.error("[age-up] one learner failed:", err instanceof Error ? err.message : err);
    }
  }
  return summary;
}

export type { WarningWindow };
