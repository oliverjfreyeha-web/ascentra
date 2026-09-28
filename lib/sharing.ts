import "server-only";
import { SYSTEM_ACTOR, recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { applyAutomaticStep } from "@/lib/enforcement";
import { SHARING, type SignalKind } from "@/lib/security-config";

/**
 * The sharing tracker (prototype: "Account-sharing safeguards", ENF, and the Credential-Sharing Policy).
 * Signals: device replacements, overlapping sessions, sign-ins too far apart to be one person.
 * Scoring is pure (scoreSignals) so the rules are testable on their own. An IP address is never a
 * signal: none is stored, so many accounts behind one address can't count against anyone.
 */

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  device_replacement: "Frequent device replacements",
  overlapping_sessions: "Repeated overlapping sessions",
  distant_sign_ins: "Sign-ins too far apart to be one person",
};

export type Signal = { id: string; kind: SignalKind; points: number; occurred_at: string; detail: string };

export type Score = { total: number; byKind: Partial<Record<SignalKind, number>>; kinds: SignalKind[]; flagged: boolean };

/** Each kind's points are capped; a flag needs the threshold AND at least SHARING.minKinds kinds. */
export function scoreSignals(signals: Pick<Signal, "kind" | "points">[]): Score {
  const byKind: Partial<Record<SignalKind, number>> = {};
  for (const s of signals) byKind[s.kind] = Math.min(SHARING.capPerKind, (byKind[s.kind] ?? 0) + s.points);
  const kinds = (Object.keys(byKind) as SignalKind[]).filter((k) => (byKind[k] ?? 0) > 0);
  const total = kinds.reduce((n, k) => n + (byKind[k] ?? 0), 0);
  return { total, byKind, kinds, flagged: total >= SHARING.threshold && kinds.length >= SHARING.minKinds };
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether two sign-ins are too far apart, too quickly, to be one person. */
export function tooFarApart(km: number, hours: number): boolean {
  return km >= SHARING.travel.minKm && km / Math.max(hours, 1 / 60) > SHARING.travel.maxKmh;
}

/** Records a signal and re-scores the account; a crossing raises a flag and starts the automatic steps. */
export async function addSignal(p: {
  accountId: string; kind: SignalKind; detail: string; sessionEventId?: string | null; deviceId?: string | null; requestId?: string | null;
}): Promise<{ flagged: boolean }> {
  const { error } = await getDb().from("sharing_signals").insert({
    account_id: p.accountId, kind: p.kind, points: SHARING.points[p.kind], detail: p.detail, session_event_id: p.sessionEventId ?? null,
  });
  if (error) throw new Error(`signal write failed: ${error.message}`);
  return evaluateSharing(p.accountId, { deviceId: p.deviceId ?? null, requestId: p.requestId ?? null });
}

/** Signals that count now: inside the window, and after the last flag (a flag uses up its signals). */
export async function countingSignals(accountId: string, now = new Date()): Promise<Signal[]> {
  const db = getDb();
  const { data: lastFlag } = await db.from("sharing_flags").select("raised_at").eq("account_id", accountId)
    .order("raised_at", { ascending: false }).limit(1).maybeSingle();
  const windowStart = new Date(now.getTime() - SHARING.windowDays * 86_400_000).toISOString();
  const since = lastFlag && String((lastFlag as { raised_at: string }).raised_at) > windowStart ? String((lastFlag as { raised_at: string }).raised_at) : windowStart;
  const { data, error } = await db.from("sharing_signals").select("*").eq("account_id", accountId)
    .gt("occurred_at", since).order("occurred_at", { ascending: true });
  if (error) throw new Error(`signal read failed: ${error.message}`);
  return (data ?? []) as Signal[];
}

export async function evaluateSharing(accountId: string, ctx: { deviceId: string | null; requestId: string | null }): Promise<{ flagged: boolean }> {
  const signals = await countingSignals(accountId);
  const score = scoreSignals(signals);
  if (!score.flagged) return { flagged: false };

  const summary = score.kinds.map((k) => `${SIGNAL_LABEL[k]} (${score.byKind[k]})`).join("; ");
  const { data: flag, error } = await getDb().from("sharing_flags").insert({
    account_id: accountId, score: score.total, threshold: SHARING.threshold, kinds: score.kinds, signal_ids: signals.map((s) => s.id),
  }).select("*").single();
  if (error || !flag) throw new Error(`flag write failed: ${error?.message}`);
  const flagId = (flag as { id: string }).id;
  const reason = `Sharing score ${score.total} reached the threshold of ${SHARING.threshold}: ${summary}.`;
  await recordAudit({
    actor: SYSTEM_ACTOR("sharing tracker"), action: "security.flag.raised", context: `Sharing flag raised. ${reason}`,
    target: { type: "account", id: accountId }, next: `score ${score.total}`, reason, result: "Completed",
    deviceId: ctx.deviceId, requestId: ctx.requestId, sensitive: true,
  });
  const step = await applyAutomaticStep(accountId, { flagId, reason, deviceId: ctx.deviceId, requestId: ctx.requestId });
  if (step) await getDb().from("sharing_flags").update({ step_applied: step }).eq("id", flagId);
  return { flagged: true };
}
