import { withCap } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isoDate, parseDob, usToday } from "@/lib/age";
import { ok, refuse } from "@/lib/http";
import { loadTargetAccount } from "@/lib/security-view";

const A = "support.dob.change";
const WHY: Record<string, [number, string]> = {
  not_found: [404, "No such account."],
  no_date_of_birth: [409, "This account has no date of birth to correct. Only learners who signed up with one have it."],
  unchanged: [400, "That is already the date of birth on file."],
  invalid: [400, "Enter a real date, like 2001-03-04."],
  changes_age_group: [409, "That date would move the account between adult and teen, or below 14. A correction can't do that."],
};

/**
 * Support (or the Owner) corrects a learner's date of birth. Body: { dateOfBirth: "YYYY-MM-DD", reason }.
 * The learner can't change it. The database applies it only within the same age group, and the audit event
 * records that it changed, not the dates.
 */
export const PATCH = withCap("support.dob.change", async (_req, ctx, _actor, x) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const target = await loadTargetAccount(accountId);
  const who = target ? { type: "account", id: target.id, label: target.email } : { type: "account", id: accountId };
  const blocked = async (code: string) => {
    const [status, reason] = WHY[code] ?? [500, "The change couldn't be made."];
    await x.audit({ action: A, context: `Refused: ${reason}`, target: who, result: "Blocked", sensitive: true });
    return refuse(status, reason);
  };
  if (!target) return blocked("not_found");
  const dob = parseDob(x.body.dateOfBirth, usToday());
  if (!dob) return blocked("invalid");

  const { data, error } = await getDb().rpc("support_change_date_of_birth", { p_account: target.id, p_dob: isoDate(dob) });
  if (error) throw new Error(`date of birth change failed: ${error.message}`);
  const outcome = Array.isArray(data) ? data[0] : data;
  if (outcome !== "changed") return blocked(String(outcome));
  await x.audit({
    action: A, context: `Corrected the date of birth of ${target.displayName} (${target.roleLabel}). The age group is unchanged.`,
    target: who, previous: "date of birth on file", next: "corrected date of birth", result: "Completed", sensitive: true,
  });
  return ok({ changed: true });
});
