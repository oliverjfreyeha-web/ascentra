import "server-only";
import { SYSTEM_ACTOR, recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { ApproxLocation } from "@/lib/devices";
import { SESSION_LIVE_SECONDS, SHARING } from "@/lib/security-config";
import { addSignal, distanceKm, tooFarApart } from "@/lib/sharing";

/**
 * Sessions (session_events rows with event_type 'session'): one per Clerk session and period of
 * activity, with its device, start, last heartbeat and end.
 *
 * One live session per account. When a second device starts, the first is paused and both show
 * "ASCENTRA is open on another device."; the person picks which one continues. A session with no
 * heartbeat for SESSION_LIVE_SECONDS is over. Two sessions that both think they're active (a race)
 * settle on the next heartbeat: the one activated last continues.
 */

export const OTHER_DEVICE_NOTICE = "ASCENTRA is open on another device.";

export type SessionRow = {
  id: string; account_id: string; trusted_device_id: string; clerk_session_id: string;
  state: "active" | "paused" | "ended"; started_at: string; activated_at: string; last_heartbeat_at: string;
  ended_at: string | null; end_reason: string | null; conflict: boolean;
  approx_region: string | null; approx_lat: number | null; approx_lon: number | null;
};

export type SessionView = {
  id: string | null;
  state: "active" | "paused" | "ended";
  endReason: string | null;
  /** Another live session exists: show OTHER_DEVICE_NOTICE. */
  conflict: boolean;
  others: { deviceId: string; state: "active" | "paused"; region: string | null; since: string }[];
};

type Ctx = { accountId: string; deviceId: string; clerkSessionId: string; loc: ApproxLocation; requestId: string | null; now?: Date };

const iso = (d: Date) => d.toISOString();
const isLive = (r: SessionRow, now: Date) => now.getTime() - new Date(r.last_heartbeat_at).getTime() <= SESSION_LIVE_SECONDS * 1000;

async function openSessions(accountId: string): Promise<SessionRow[]> {
  const { data, error } = await getDb().from("session_events").select("*").eq("account_id", accountId)
    .eq("event_type", "session").is("ended_at", null);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

async function update(id: string, patch: Partial<SessionRow>) {
  const { error } = await getDb().from("session_events").update(patch).eq("id", id);
  if (error) throw new Error(`session update failed: ${error.message}`);
}

/** Open sessions whose heartbeat stopped are ended (timed out) at their last heartbeat. Returns the live ones. */
async function liveSessions(accountId: string, now: Date): Promise<SessionRow[]> {
  const rows = await openSessions(accountId);
  for (const r of rows.filter((r) => !isLive(r, now))) {
    await update(r.id, { state: "ended", ended_at: r.last_heartbeat_at, end_reason: "timed_out", conflict: false });
  }
  return rows.filter((r) => isLive(r, now));
}

const view = (mine: SessionRow, others: SessionRow[]): SessionView => ({
  id: mine.id, state: mine.state, endReason: mine.end_reason, conflict: mine.conflict,
  others: others.map((o) => ({ deviceId: o.trusted_device_id, state: o.state as "active" | "paused", region: o.approx_region, since: o.started_at })),
});

/**
 * A heartbeat from a trusted device. Starts the session if this Clerk session has none open
 * (pausing any other live one), otherwise keeps it alive.
 */
export async function heartbeat(c: Ctx): Promise<SessionView> {
  const now = c.now ?? new Date();
  const live = await liveSessions(c.accountId, now);
  let mine = live.find((r) => r.clerk_session_id === c.clerkSessionId) ?? null;
  let others = live.filter((r) => r !== mine);

  if (!mine) {
    // A session signed out from elsewhere, removed with its device, or suspended doesn't come back.
    const { data: last } = await getDb().from("session_events").select("*").eq("clerk_session_id", c.clerkSessionId)
      .eq("event_type", "session").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const prev = last as SessionRow | null;
    if (prev && prev.end_reason && prev.end_reason !== "timed_out") {
      return { id: prev.id, state: "ended", endReason: prev.end_reason, conflict: false, others: [] };
    }
    mine = await startSession(c, now, others);
    others = (await liveSessions(c.accountId, now)).filter((r) => r.id !== mine!.id);
    return view(mine, others);
  }

  const patch: Partial<SessionRow> = { last_heartbeat_at: iso(now) };
  if (mine.state === "active") {
    const rival = others.filter((o) => o.state === "active");
    if (rival.length) {
      // Two active sessions: the one activated last continues, the rest pause.
      const newest = [mine, ...rival].sort((a, b) => b.activated_at.localeCompare(a.activated_at))[0];
      for (const r of [mine, ...rival].filter((r) => r !== newest)) {
        if (r === mine) Object.assign(patch, { state: "paused", conflict: true });
        else await update(r.id, { state: "paused", conflict: true });
      }
      if (newest === mine) patch.conflict = true;
    }
  }
  if (!others.length && mine.conflict) patch.conflict = false;
  if (others.length && !mine.conflict && mine.state === "paused") patch.conflict = true;
  await update(mine.id, patch);
  mine = { ...mine, ...patch };
  others = (await openSessions(c.accountId)).filter((r) => r.id !== mine!.id && isLive(r, now));
  return view(mine, others);
}

async function startSession(c: Ctx, now: Date, others: SessionRow[]): Promise<SessionRow> {
  const { data, error } = await getDb().from("session_events").insert({
    account_id: c.accountId, trusted_device_id: c.deviceId, event_type: "session", description: "Session",
    clerk_session_id: c.clerkSessionId, state: "active", started_at: iso(now), activated_at: iso(now), last_heartbeat_at: iso(now),
    conflict: others.length > 0, approx_region: c.loc.region, approx_lat: c.loc.lat, approx_lon: c.loc.lon, occurred_at: iso(now),
  }).select("*").single();
  if (error || !data) throw new Error(`session start failed: ${error?.message}`);
  const mine = data as SessionRow;

  if (others.length) {
    for (const o of others) await update(o.id, { state: "paused", conflict: true });
    const otherDevices = [...new Set(others.map((o) => o.trusted_device_id))];
    await recordAudit({
      actor: SYSTEM_ACTOR("sessions"), action: "session.paused",
      context: `A session started while ${others.length === 1 ? "another session was" : `${others.length} other sessions were`} open; the other ${others.length === 1 ? "session was" : "sessions were"} paused. ${OTHER_DEVICE_NOTICE}`,
      target: { type: "account", id: c.accountId }, result: "Completed", deviceId: c.deviceId, requestId: c.requestId,
    });
    const since = iso(new Date(now.getTime() - SHARING.overlapCooldownMinutes * 60_000));
    const { data: recent } = await getDb().from("sharing_signals").select("id").eq("account_id", c.accountId)
      .eq("kind", "overlapping_sessions").gte("occurred_at", since).limit(1);
    if (otherDevices.some((d) => d !== c.deviceId) && !((recent ?? []) as unknown[]).length) {
      await addSignal({
        accountId: c.accountId, kind: "overlapping_sessions", sessionEventId: mine.id, deviceId: c.deviceId, requestId: c.requestId,
        detail: `A session started on a second device while one was open on ${otherDevices.filter((d) => d !== c.deviceId).length === 1 ? "another device" : "other devices"}.`,
      });
    }
  }
  await checkDistance(c, now, mine);
  return mine;
}

/** A sign-in far from the last one on another device, sooner than travel allows, is a signal. */
async function checkDistance(c: Ctx, now: Date, mine: SessionRow) {
  if (c.loc.lat == null || c.loc.lon == null) return;
  const since = iso(new Date(now.getTime() - SHARING.travel.lookbackHours * 3_600_000));
  const { data } = await getDb().from("session_events").select("*").eq("account_id", c.accountId).eq("event_type", "session")
    .gte("last_heartbeat_at", since).order("last_heartbeat_at", { ascending: false }).limit(20);
  const recent = (data ?? []) as SessionRow[];
  const prev = recent.find((r) => r.id !== mine.id && r.trusted_device_id !== c.deviceId && r.approx_lat != null && r.approx_lon != null);
  if (!prev) return;
  // One trip is one signal: at most one per account in the lookback window, whichever device moved.
  const { data: earlier } = await getDb().from("sharing_signals").select("id").eq("account_id", c.accountId)
    .eq("kind", "distant_sign_ins").gte("occurred_at", since).limit(1);
  if (((earlier ?? []) as unknown[]).length) return;
  const km = distanceKm({ lat: prev.approx_lat!, lon: prev.approx_lon! }, { lat: c.loc.lat, lon: c.loc.lon });
  const hours = (now.getTime() - new Date(prev.last_heartbeat_at).getTime()) / 3_600_000;
  if (!tooFarApart(km, hours)) return;
  const mins = Math.max(1, Math.round(hours * 60));
  await addSignal({
    accountId: c.accountId, kind: "distant_sign_ins", sessionEventId: mine.id, deviceId: c.deviceId, requestId: c.requestId,
    detail: `Sign-ins about ${Math.round(km / 10) * 10} km apart within ${mins < 120 ? `${mins} minutes` : `${Math.round(hours)} hours`} (${prev.approx_region ?? "unknown region"} → ${c.loc.region ?? "unknown region"}).`,
  });
}

/** "Continue here": this session continues, every other live one pauses. */
export async function continueHere(accountId: string, clerkSessionId: string, now = new Date()): Promise<SessionView | null> {
  const live = await liveSessions(accountId, now);
  const mine = live.find((r) => r.clerk_session_id === clerkSessionId);
  if (!mine) return null;
  const others = live.filter((r) => r !== mine);
  for (const o of others) await update(o.id, { state: "paused", conflict: true });
  const patch = { state: "active" as const, activated_at: iso(now), last_heartbeat_at: iso(now), conflict: others.length > 0 };
  await update(mine.id, patch);
  return view({ ...mine, ...patch }, others.map((o) => ({ ...o, state: "paused" as const })));
}

/** Ends this Clerk session's open row. With "signed_out", the most recent paused session, if any, continues. */
export async function endSession(accountId: string, clerkSessionId: string, reason: "signed_out", now = new Date()): Promise<boolean> {
  const live = await liveSessions(accountId, now);
  const mine = live.find((r) => r.clerk_session_id === clerkSessionId);
  if (!mine) return false;
  await update(mine.id, { state: "ended", ended_at: iso(now), end_reason: reason, conflict: false });
  const rest = live.filter((r) => r !== mine);
  const next = rest.sort((a, b) => b.last_heartbeat_at.localeCompare(a.last_heartbeat_at))[0];
  if (next && !rest.some((r) => r.state === "active")) await update(next.id, { state: "active", activated_at: iso(now), conflict: rest.length > 1 });
  return true;
}

/**
 * Ends every open session on a device (signed out remotely, or the device removed). Returns the Clerk
 * session ids to sign out: the open ones, and idle ones that only timed out (still signed in to Clerk).
 */
export async function endDeviceSessions(accountId: string, deviceId: string, reason: "signed_out_remotely" | "device_removed" | "suspended", now = new Date()): Promise<string[]> {
  const rows = (await openSessions(accountId)).filter((r) => r.trusted_device_id === deviceId);
  for (const r of rows) await update(r.id, { state: "ended", ended_at: iso(now), end_reason: reason, conflict: false });
  const { data } = await getDb().from("session_events").select("clerk_session_id").eq("account_id", accountId).eq("event_type", "session")
    .eq("trusted_device_id", deviceId).eq("end_reason", "timed_out");
  const idle = ((data ?? []) as { clerk_session_id: string }[]).map((r) => r.clerk_session_id);
  return [...new Set([...rows.map((r) => r.clerk_session_id), ...idle])];
}

/** Every open session of an account (suspension signs them all out). */
export async function endAllSessions(accountId: string, reason: "suspended", now = new Date()): Promise<string[]> {
  const rows = await openSessions(accountId);
  for (const r of rows) await update(r.id, { state: "ended", ended_at: iso(now), end_reason: reason, conflict: false });
  return rows.map((r) => r.clerk_session_id);
}

export async function recentSessions(accountId: string, limit = 50): Promise<SessionRow[]> {
  const { data, error } = await getDb().from("session_events").select("*").eq("account_id", accountId).eq("event_type", "session")
    .order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`session read failed: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

/** Pairs of sessions on different devices whose times overlapped. */
export function overlaps(rows: SessionRow[]): { a: SessionRow; b: SessionRow }[] {
  const out: { a: SessionRow; b: SessionRow }[] = [];
  const end = (r: SessionRow) => new Date(r.ended_at ?? r.last_heartbeat_at).getTime();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.trusted_device_id === b.trusted_device_id) continue;
      if (new Date(a.started_at).getTime() < end(b) && new Date(b.started_at).getTime() < end(a)) out.push({ a, b });
    }
  }
  return out;
}
