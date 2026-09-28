import "server-only";
import { findLiveAssignment, findProfile, type AccountRow } from "@/lib/accounts";
import { roleKeyOf } from "@/lib/auth";
import { ROLE_LABEL, type RoleKey } from "@/lib/caps";
import { getDb } from "@/lib/db";
import { summarize } from "@/lib/device-actions";
import { listTrustedDevices, type DeviceRow } from "@/lib/devices";
import { effectOf, listAppeals, listSteps, STEP_LABEL, type AppealRow, type Enforcement } from "@/lib/enforcement";
import { DEVICE_LIMIT } from "@/lib/security-config";
import { overlaps, recentSessions, type SessionRow } from "@/lib/sessions";
import { SIGNAL_LABEL, countingSignals, scoreSignals, type Signal } from "@/lib/sharing";

/**
 * What the account views show. Security data only: devices, sessions, overlaps, signals, flags, steps,
 * appeals. Nothing about payment (support "Never sees payment details"), notes or Mentor conversations.
 */

export type TargetAccount = { id: string; email: string; displayName: string; roleKey: RoleKey; roleLabel: string; status: string };

export async function loadTargetAccount(accountId: string): Promise<TargetAccount | null> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const { data, error } = await getDb().from("accounts").select("*").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`account read failed: ${error.message}`);
  const row = data as AccountRow | null;
  if (!row) return null;
  const assignment = row.role === "admin" ? await findLiveAssignment(row.id) : null;
  const roleKey = roleKeyOf(row, assignment) ?? "learner";
  const profile = await findProfile(row.id);
  return { id: row.id, email: row.email, displayName: profile?.display_name ?? row.email, roleKey, roleLabel: ROLE_LABEL[roleKey], status: row.status };
}

/** Exact email match, or an account id. Staff look accounts up; they don't browse a list of everyone. */
export async function findTargetAccount(q: string): Promise<TargetAccount | null> {
  const s = q.trim().toLowerCase().slice(0, 200);
  if (!s) return null;
  if (/^[0-9a-f-]{36}$/.test(s)) return loadTargetAccount(s);
  const { data, error } = await getDb().from("accounts").select("id").eq("email", s).maybeSingle();
  if (error) throw new Error(`account search failed: ${error.message}`);
  return data ? loadTargetAccount((data as { id: string }).id) : null;
}

export const publicEnforcement = (e: Enforcement) => ({
  step: e.step, label: e.label, text: e.text, reason: e.reason, since: e.since, automatic: e.automatic,
  limitUntil: e.limitUntil, limited: e.limited, suspended: e.suspended, needsVerify: e.needsVerify, noticeUnread: e.noticeUnread,
});

const appealView = (a: AppealRow) => ({
  id: a.id, reference: a.reference, step: STEP_LABEL[a.step], text: a.text, status: a.status,
  submittedAt: a.created_at, decidedAt: a.decided_at, decisionReason: a.decision_reason,
});

function sessionView(r: SessionRow, names: Map<string, string>) {
  return {
    id: r.id, device: names.get(r.trusted_device_id) ?? "Removed device", deviceId: r.trusted_device_id, state: r.state,
    startedAt: r.started_at, lastHeartbeatAt: r.last_heartbeat_at, endedAt: r.ended_at, endReason: r.end_reason, region: r.approx_region,
  };
}

async function allDevices(accountId: string): Promise<DeviceRow[]> {
  const { data, error } = await getDb().from("trusted_devices").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(`device read failed: ${error.message}`);
  return (data ?? []) as DeviceRow[];
}

/** The person's own view (/account): their devices, recent sessions, current step and appeals. */
export async function ownSecurity(accountId: string, roleKey: RoleKey, currentDeviceId: string | null) {
  const [devices, sessions, steps, appeals] = await Promise.all([
    listTrustedDevices(accountId), recentSessions(accountId, 20), listSteps(accountId, 20), listAppeals({ accountId }, 20),
  ]);
  const names = new Map((await allDevices(accountId)).map((d) => [d.id, d.name]));
  const enforcement = effectOf((steps[0] as Parameters<typeof effectOf>[0]) ?? null, roleKey);
  return {
    deviceLimit: DEVICE_LIMIT,
    devices: devices.map((d) => ({ ...summarize(d, currentDeviceId), active: sessions.some((s) => s.trusted_device_id === d.id && s.state !== "ended") })),
    sessions: sessions.map((s) => sessionView(s, names)),
    enforcement: publicEnforcement(enforcement),
    history: steps.map((s) => ({ step: s.step === "cleared" ? "Cleared" : STEP_LABEL[s.step], automatic: s.automatic, reason: s.reason, at: s.created_at })),
    appeals: appeals.map(appealView),
  };
}

/** The staff view (Owner, Super Admin, Support). */
export async function staffSecurity(target: TargetAccount) {
  const db = getDb();
  const [devices, sessions, steps, appeals, signals] = await Promise.all([
    allDevices(target.id), recentSessions(target.id, 50), listSteps(target.id, 50), listAppeals({ accountId: target.id }, 50),
    db.from("sharing_signals").select("*").eq("account_id", target.id).order("occurred_at", { ascending: false }).limit(100),
  ]);
  const { data: flags } = await db.from("sharing_flags").select("*").eq("account_id", target.id).order("raised_at", { ascending: false }).limit(50);
  const names = new Map(devices.map((d) => [d.id, d.name]));
  const enforcement = effectOf((steps[0] as Parameters<typeof effectOf>[0]) ?? null, target.roleKey);
  const counting = scoreSignals(await countingSignals(target.id));
  return {
    account: target,
    deviceLimit: DEVICE_LIMIT,
    devices: devices.map((d) => ({
      id: d.id, name: d.name, kind: d.kind, region: d.approx_region, state: d.trust_state, trustedAt: d.trusted_at,
      lastSeenAt: d.last_seen_at, revokedAt: d.revoked_at,
    })),
    sessions: sessions.map((s) => sessionView(s, names)),
    overlaps: overlaps(sessions).map(({ a, b }) => ({ a: sessionView(a, names), b: sessionView(b, names) })),
    signals: ((signals.data ?? []) as Signal[]).map((s) => ({ kind: SIGNAL_LABEL[s.kind], points: s.points, detail: s.detail, at: s.occurred_at })),
    score: { total: counting.total, kinds: counting.kinds.map((k) => SIGNAL_LABEL[k]) },
    flags: ((flags ?? []) as { id: string; score: number; threshold: number; kinds: string[]; step_applied: string | null; raised_at: string }[]).map((f) => ({
      id: f.id, score: f.score, threshold: f.threshold, kinds: f.kinds.map((k) => SIGNAL_LABEL[k as keyof typeof SIGNAL_LABEL] ?? k),
      stepApplied: f.step_applied ? STEP_LABEL[f.step_applied as "notice"] : null, raisedAt: f.raised_at,
    })),
    enforcement: publicEnforcement(enforcement),
    history: steps.map((s) => ({
      step: s.step === "cleared" ? "Cleared" : STEP_LABEL[s.step], automatic: s.automatic, appliedBy: s.applied_by_account_id,
      reason: s.reason, at: s.created_at, limitUntil: s.limit_until,
    })),
    appeals: appeals.map(appealView),
  };
}

/** The review queue: appeals under review, oldest first, with whose account they concern. */
export async function appealQueue() {
  const rows = (await listAppeals({ status: "under_review" }, 200)).reverse();
  const out = [];
  for (const a of rows) {
    const t = await loadTargetAccount(a.account_id);
    out.push({ ...appealView(a), account: t ? { id: t.id, email: t.email, displayName: t.displayName, role: t.roleLabel } : null });
  }
  return out;
}
