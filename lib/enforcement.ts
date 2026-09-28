import "server-only";
import { SYSTEM_ACTOR, recordAudit, type AuditInput } from "@/lib/audit";
import { decide, type RoleKey } from "@/lib/caps";
import { getDb } from "@/lib/db";
import { APPEAL_MAX, APPEAL_MIN, LIMIT_HOURS } from "@/lib/security-config";

/**
 * The graduated steps after a sharing flag (prototype ENF / "Account-sharing safeguards"):
 *   Notice → Verify → Limit → Suspend, one at a time, each explained, each appealable, each audited
 *   with a reason. Only Notice and Verify are automatic. Limit needs Support (or the Owner); Suspend
 *   needs a Super Admin or the Owner, after a person has already limited the account.
 * The Owner is never limited or suspended, by anyone (also enforced by the database, 0007).
 */

export const STEPS = ["notice", "verify", "limit", "suspend"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABEL: Record<Step, string> = { notice: "Notice", verify: "Verify", limit: "Limit", suspend: "Suspend" };
export const STEP_TEXT: Record<Step, string> = {
  notice: "We noticed signs that more than one person may be using this account. Each account is for one person.",
  verify: "Before continuing, confirm it's you with your second factor. This happens when sign-ins look unusual.",
  limit: "New devices can't be added or replaced for now. You can keep using your current trusted devices.",
  suspend: "A person reviewed the session history and suspended the account. You can explain what happened in an appeal.",
};

type StepRow = {
  id: string; account_id: string; step: Step | "cleared"; automatic: boolean; applied_by_account_id: string | null;
  reason: string; flag_id: string | null; limit_until: string | null; acknowledged_at: string | null; created_at: string;
};

export type Enforcement = {
  step: Step | null;
  stepId: string | null;
  label: string | null;
  text: string | null;
  reason: string | null;
  since: string | null;
  automatic: boolean;
  limitUntil: string | null;
  /** In effect now: no new devices or replacements. */
  limited: boolean;
  /** In effect now: signed-in pages and the API refuse everything except security and appeals. */
  suspended: boolean;
  /** Verify step not yet completed: pages ask for the second factor first. */
  needsVerify: boolean;
  /** Notice not yet read. */
  noticeUnread: boolean;
};

export const NO_ENFORCEMENT: Enforcement = {
  step: null, stepId: null, label: null, text: null, reason: null, since: null, automatic: false, limitUntil: null,
  limited: false, suspended: false, needsVerify: false, noticeUnread: false,
};

async function latestStep(accountId: string): Promise<StepRow | null> {
  const { data, error } = await getDb().from("enforcement_steps").select("*").eq("account_id", accountId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`enforcement read failed: ${error.message}`);
  return (data as StepRow | null) ?? null;
}

/** The step in effect for an account. The Owner is never limited or suspended, whatever is stored. */
export function effectOf(row: StepRow | null, roleKey: RoleKey, now = new Date()): Enforcement {
  if (!row || row.step === "cleared") return NO_ENFORCEMENT;
  const step = row.step;
  const owner = roleKey === "owner";
  const limitLive = step === "limit" && !!row.limit_until && new Date(row.limit_until) > now;
  return {
    step, stepId: row.id, label: STEP_LABEL[step], text: STEP_TEXT[step], reason: row.reason, since: row.created_at,
    automatic: row.automatic, limitUntil: step === "limit" ? row.limit_until : null,
    limited: !owner && limitLive,
    suspended: !owner && step === "suspend",
    needsVerify: step === "verify" && !row.acknowledged_at,
    noticeUnread: step === "notice" && !row.acknowledged_at,
  };
}

export async function currentEnforcement(accountId: string, roleKey: RoleKey): Promise<Enforcement> {
  return effectOf(await latestStep(accountId), roleKey);
}

async function insertStep(row: Omit<StepRow, "id" | "created_at" | "acknowledged_at">): Promise<StepRow> {
  const { data, error } = await getDb().from("enforcement_steps").insert(row).select("*").single();
  if (error || !data) throw new Error(`enforcement write failed: ${error?.message}`);
  return data as StepRow;
}

/**
 * After a flag: none → Notice, Notice → Verify, a completed Verify → Verify again. At Limit or Suspend
 * nothing automatic happens (the flag waits for a person). Returns the step applied, if any.
 */
export async function applyAutomaticStep(accountId: string, p: { flagId: string; reason: string; deviceId: string | null; requestId: string | null }): Promise<"notice" | "verify" | null> {
  const cur = await latestStep(accountId);
  const at = !cur || cur.step === "cleared" ? null : cur.step;
  let next: "notice" | "verify" | null = null;
  if (at === null) next = "notice";
  else if (at === "notice") next = "verify";
  else if (at === "verify" && cur?.acknowledged_at) next = "verify";
  if (!next) return null;
  await insertStep({ account_id: accountId, step: next, automatic: true, applied_by_account_id: null, reason: p.reason, flag_id: p.flagId, limit_until: null });
  await recordAudit({
    actor: SYSTEM_ACTOR("sharing tracker"), action: `security.step.${next}`,
    context: `Account-sharing step applied automatically: ${STEP_LABEL[next]}. ${STEP_TEXT[next]}`,
    target: { type: "account", id: accountId }, previous: at ? STEP_LABEL[at] : "None", next: STEP_LABEL[next],
    reason: p.reason, result: "Completed", deviceId: p.deviceId, requestId: p.requestId, sensitive: true,
  });
  return next;
}

/** The person read the Notice, or passed the Verify check. */
export async function acknowledgeStep(accountId: string, step: "notice" | "verify"): Promise<boolean> {
  const cur = await latestStep(accountId);
  if (!cur || cur.step !== step || cur.acknowledged_at) return false;
  const { error } = await getDb().from("enforcement_steps").update({ acknowledged_at: new Date().toISOString() }).eq("id", cur.id);
  if (error) throw new Error(`enforcement update failed: ${error.message}`);
  return true;
}

// ============ Steps a person applies ============

type Outcome = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type StepResult = { ok: true; status: number; event: Outcome } | { ok: false; status: number; reason: string; event: Outcome };

type Target = { id: string; roleKey: RoleKey; label: string };

const blocked = (status: number, reason: string, action: string, t: Target): StepResult => ({
  ok: false, status, reason,
  event: { action, context: `Refused: ${reason}`, target: { type: "account", id: t.id, label: t.label }, result: "Blocked" },
});

/**
 * Limit (Support or the Owner) or Suspend (Super Admin or the Owner). One step at a time: Limit needs the
 * account to be at Verify after a flag; Suspend needs a Limit a person already applied. Never the Owner,
 * never your own account.
 */
export async function applyStaffStep(actor: { id: string; roleKey: RoleKey }, target: Target, step: "limit" | "suspend", reason: string): Promise<StepResult> {
  const action = `security.${step}`;
  if (!decide({ role: actor.roleKey, assignedCourses: [] }, action as "security.limit").allowed) {
    return blocked(403, step === "limit" ? "Only Support or the Owner can apply Limit." : "Only a Super Admin or the Owner can apply Suspend.", action, target);
  }
  if (target.roleKey === "owner") return blocked(403, "The Owner can't be limited or suspended.", action, target);
  if (target.id === actor.id) return blocked(403, "You can't apply a step to your own account.", action, target);

  const cur = await latestStep(target.id);
  const at = !cur || cur.step === "cleared" ? null : cur.step;
  if (step === "limit" && at !== "verify") {
    return blocked(409, `Limit comes after Verify. This account is at ${at ? STEP_LABEL[at] : "no step"}.`, action, target);
  }
  if (step === "suspend" && at !== "limit") {
    return blocked(409, `Suspend comes after a person applies Limit. This account is at ${at ? STEP_LABEL[at] : "no step"}.`, action, target);
  }
  const limitUntil = step === "limit" ? new Date(Date.now() + LIMIT_HOURS * 3_600_000).toISOString() : null;
  await insertStep({ account_id: target.id, step, automatic: false, applied_by_account_id: actor.id, reason, flag_id: cur?.flag_id ?? null, limit_until: limitUntil });
  return {
    ok: true, status: 200,
    event: {
      action, context: `Account-sharing step applied after review: ${STEP_LABEL[step]}. ${STEP_TEXT[step]}${limitUntil ? ` Until ${limitUntil}.` : ""}`,
      target: { type: "account", id: target.id, label: target.label }, previous: at ? STEP_LABEL[at] : "None", next: STEP_LABEL[step],
      result: "Completed", sensitive: true,
    },
  };
}

// ============ Appeals ============

export type AppealRow = {
  id: string; reference: string; account_id: string; enforcement_step_id: string; step: Step; text: string;
  status: "under_review" | "accepted" | "declined"; decided_by_account_id: string | null; decision_reason: string | null;
  decided_at: string | null; created_at: string;
};

export async function submitAppeal(account: { id: string; roleKey: RoleKey }, text: string): Promise<StepResult & { appeal?: AppealRow }> {
  const t = text.trim();
  const target = { id: account.id, roleKey: account.roleKey, label: "own account" };
  const cur = await latestStep(account.id);
  if (!cur || cur.step === "cleared") return blocked(409, "There's no step on your account to appeal.", "security.appeal.submit", target);
  if (t.length < APPEAL_MIN) return blocked(400, `Tell us a little more (at least ${APPEAL_MIN} characters) so a person can review it.`, "security.appeal.submit", target);
  if (t.length > APPEAL_MAX) return blocked(400, `Keep the appeal under ${APPEAL_MAX} characters.`, "security.appeal.submit", target);
  const { data, error } = await getDb().from("appeals").insert({ account_id: account.id, enforcement_step_id: cur.id, step: cur.step, text: t }).select("*").single();
  if (error?.code === "23505") return blocked(409, "You already have an appeal under review.", "security.appeal.submit", target);
  if (error || !data) throw new Error(`appeal write failed: ${error?.message}`);
  const appeal = data as AppealRow;
  return {
    ok: true, status: 201, appeal,
    event: {
      action: "security.appeal.submit", context: `Appeal ${appeal.reference} submitted against ${STEP_LABEL[cur.step]}. A person reviews it before anything else happens.`,
      target: { type: "appeal", id: appeal.id, label: appeal.reference }, next: "Under review", result: "Completed", sensitive: true,
    },
  };
}

export async function getAppeal(id: string): Promise<AppealRow | null> {
  const { data, error } = await getDb().from("appeals").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`appeal read failed: ${error.message}`);
  return (data as AppealRow | null) ?? null;
}

/**
 * Accept (the step is cleared) or decline (it stays). Appeals against Suspend need a Super Admin or the
 * Owner; the rest, anyone who decides appeals (Support, Super Admin, Owner). Not your own.
 */
export async function decideAppeal(actor: { id: string; roleKey: RoleKey }, appealId: string, decision: "accept" | "decline", reason: string): Promise<StepResult> {
  const action = "support.appeal.decide";
  const appeal = await getAppeal(appealId);
  const target = { id: appealId, roleKey: "learner" as RoleKey, label: appeal?.reference ?? appealId };
  const refuse = (status: number, why: string): StepResult => ({ ok: false, status, reason: why, event: { action, context: `Refused: ${why}`, target: { type: "appeal", id: appealId, label: target.label }, result: "Blocked" } });
  if (!appeal) return refuse(404, "There's no such appeal.");
  if (appeal.status !== "under_review") return refuse(409, `Appeal ${appeal.reference} was already decided.`);
  if (appeal.account_id === actor.id) return refuse(403, "You can't decide your own appeal.");
  if (appeal.step === "suspend" && !decide({ role: actor.roleKey, assignedCourses: [] }, "security.suspend").allowed) {
    return refuse(403, "Appeals against Suspend are decided by a Super Admin or the Owner.");
  }
  const now = new Date().toISOString();
  const { data, error } = await getDb().from("appeals")
    .update({ status: decision === "accept" ? "accepted" : "declined", decided_by_account_id: actor.id, decision_reason: reason, decided_at: now })
    .eq("id", appealId).eq("status", "under_review").select("id");
  if (error) throw new Error(`appeal update failed: ${error.message}`);
  if (!((data as unknown[] | null) ?? []).length) return refuse(409, `Appeal ${appeal.reference} was already decided.`);

  let cleared = false;
  if (decision === "accept") {
    // Clear the step only if it's still the one appealed against.
    const cur = await latestStep(appeal.account_id);
    if (cur && cur.id === appeal.enforcement_step_id) {
      await insertStep({ account_id: appeal.account_id, step: "cleared", automatic: false, applied_by_account_id: actor.id, reason: `Appeal ${appeal.reference} accepted: ${reason}`, flag_id: null, limit_until: null });
      cleared = true;
    }
  }
  return {
    ok: true, status: 200,
    event: {
      action, context: decision === "accept"
        ? `Appeal ${appeal.reference} accepted${cleared ? `; ${STEP_LABEL[appeal.step]} lifted` : "; a later step is still in place"}.`
        : `Appeal ${appeal.reference} declined; ${STEP_LABEL[appeal.step]} stays.`,
      target: { type: "appeal", id: appeal.id, label: appeal.reference }, previous: "Under review",
      next: decision === "accept" ? "Accepted" : "Declined", result: "Completed", sensitive: true,
    },
  };
}

export async function listAppeals(filter: { status?: "under_review"; accountId?: string } = {}, limit = 100): Promise<AppealRow[]> {
  let q = getDb().from("appeals").select("*").order("created_at", { ascending: false }).limit(limit);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  const { data, error } = await q;
  if (error) throw new Error(`appeal list failed: ${error.message}`);
  return (data ?? []) as AppealRow[];
}

export async function listSteps(accountId: string, limit = 50): Promise<StepRow[]> {
  const { data, error } = await getDb().from("enforcement_steps").select("*").eq("account_id", accountId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`enforcement read failed: ${error.message}`);
  return (data ?? []) as StepRow[];
}
