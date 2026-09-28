import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { AuditInput } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { addSignal } from "@/lib/sharing";
import {
  approxLocation, claimDeviceSlot, describeDevice, deviceCookie, deviceKeyHash, getDevice, listTrustedDevices, newDeviceToken,
  recordSessionEvent, revokeDevice, type DeviceRow, type RequestDevice,
} from "@/lib/devices";
import type { Enforcement } from "@/lib/enforcement";
import { DEVICE_LIMIT } from "@/lib/security-config";
import { endDeviceSessions } from "@/lib/sessions";
import type { RoleKey } from "@/lib/caps";

/** What a route needs to record: the event (withCap adds actor, request id and reason). */
export type Outcome = Omit<AuditInput, "actor" | "requestId" | "reason">;

export type DeviceSummary = { id: string; name: string; kind: string; region: string | null; trustedAt: string | null; lastSeenAt: string | null; current: boolean };
export const summarize = (d: DeviceRow, currentId: string | null): DeviceSummary => ({
  id: d.id, name: d.name, kind: d.kind, region: d.approx_region, trustedAt: d.trusted_at, lastSeenAt: d.last_seen_at, current: d.id === currentId,
});

/** Signs out Clerk sessions (best effort: one that's already gone is fine). */
export async function revokeClerkSessions(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const client = await clerkClient();
  for (const id of ids) {
    try {
      await client.sessions.revokeSession(id);
    } catch (err) {
      console.error("[devices] could not revoke Clerk session", id, err instanceof Error ? err.message : err);
    }
  }
}

export type Registration =
  | { trusted: true; device: DeviceRow; setCookie: string | null; registered: boolean }
  | { trusted: false; setCookie: string | null; keyHash: string; why: "full" | "limited"; devices: DeviceRow[]; name: string };

/**
 * The first verified sign-in on a device registers it, while a slot is free. A new browser gets its
 * device cookie here. Past the limit, or while the account is limited, the device isn't trusted.
 */
export async function registerDevice(p: {
  req: Request; accountId: string; device: RequestDevice; enforcement: Enforcement; clerkSessionId: string | null;
}): Promise<Registration> {
  if (p.device.device) return { trusted: true, device: p.device.device, setCookie: null, registered: false };
  const token = p.device.token ?? newDeviceToken();
  const setCookie = p.device.token ? null : deviceCookie(token);
  const keyHash = deviceKeyHash(token);
  const { name, kind } = describeDevice(p.req.headers.get("user-agent"));
  const loc = approxLocation(p.req.headers);

  const held = async (why: "full" | "limited"): Promise<Registration> => {
    await noteHeld(p.accountId, p.clerkSessionId, name, loc.region, why);
    return { trusted: false, setCookie, keyHash, why, devices: await listTrustedDevices(p.accountId), name };
  };
  if (p.enforcement.limited) return held("limited");

  const claim = await claimDeviceSlot({ accountId: p.accountId, keyHash, name, kind, region: loc.region });
  if (claim.outcome === "full") return held("full");
  const device = await getDevice(p.accountId, claim.deviceId!);
  if (!device) throw new Error("registered device not found");
  if (claim.outcome === "registered") {
    await recordSessionEvent({ accountId: p.accountId, deviceId: device.id, type: "device_added", description: `Trusted a new device: ${name}.`, region: loc.region, clerkSessionId: p.clerkSessionId });
  }
  return { trusted: true, device, setCookie, registered: claim.outcome === "registered" };
}

/** One "held" event per Clerk session, not one per page load. */
async function noteHeld(accountId: string, clerkSessionId: string | null, name: string, region: string | null, why: "full" | "limited") {
  if (clerkSessionId) {
    const { data } = await getDb().from("session_events").select("id").eq("clerk_session_id", clerkSessionId).eq("event_type", "sign_in_held").limit(1).maybeSingle();
    if (data) return;
  }
  await recordSessionEvent({
    accountId, deviceId: null, type: "sign_in_held", region, clerkSessionId,
    description: why === "full"
      ? `Sign-in on ${name} held: all ${DEVICE_LIMIT} trusted-device slots are in use. Replacing one needs a second-factor check.`
      : `Sign-in on ${name} held: new devices are paused while the account is limited.`,
  });
}

export type ActionResult = { ok: true; status: number; event: Outcome; body: Record<string, unknown>; setCookie?: string | null } | { ok: false; status: number; reason: string; event: Outcome };

/**
 * A device past the limit replaces one the person picks, after a second-factor check (withCap's
 * reverification). The Owner can always do this; anyone else can't while the account is limited.
 * Replacing counts toward the sharing tracker.
 */
export async function replaceDevice(p: {
  req: Request; account: { id: string; roleKey: RoleKey }; device: RequestDevice; enforcement: Enforcement; replaceId: string;
  clerkSessionId: string | null; requestId: string;
}): Promise<ActionResult> {
  const { name, kind } = describeDevice(p.req.headers.get("user-agent"));
  const target = { type: "device", id: p.replaceId };
  const refuse = (status: number, reason: string): ActionResult => ({ ok: false, status, reason, event: { action: "devices.replace", context: `Refused: ${reason}`, target, result: "Blocked" } });
  if (p.device.device) return refuse(409, "This device is already trusted.");
  if (p.enforcement.limited && p.account.roleKey !== "owner") {
    return refuse(403, `New devices can't be added or replaced until ${p.enforcement.limitUntil}. You can appeal on your account page.`);
  }
  const old = await getDevice(p.account.id, p.replaceId);
  if (!old || old.trust_state !== "trusted") return refuse(404, "That device isn't one of your trusted devices.");

  const token = p.device.token ?? newDeviceToken();
  const setCookie = p.device.token ? null : deviceCookie(token);
  const loc = approxLocation(p.req.headers);
  const claim = await claimDeviceSlot({ accountId: p.account.id, keyHash: deviceKeyHash(token), name, kind, region: loc.region, replaceId: old.id });
  if (claim.outcome === "existing") return refuse(409, "This device is already trusted.");
  if (claim.outcome !== "replaced") return refuse(404, "That device isn't one of your trusted devices.");

  const ended = await endDeviceSessions(p.account.id, old.id, "device_removed");
  await revokeClerkSessions(ended);
  await recordSessionEvent({ accountId: p.account.id, deviceId: claim.deviceId, type: "device_replaced", description: `Replaced ${old.name} with ${name}.`, region: loc.region, clerkSessionId: p.clerkSessionId });
  await addSignal({ accountId: p.account.id, kind: "device_replacement", detail: `Replaced ${old.name} with ${name}.`, deviceId: claim.deviceId, requestId: p.requestId });
  return {
    ok: true, status: 200, setCookie,
    body: { replaced: old.id, device: claim.deviceId },
    event: {
      action: "devices.replace", context: `Replaced trusted device ${old.name} with ${name} after a second-factor check.`,
      target: { type: "device", id: old.id, label: old.name }, previous: old.name, next: name, result: "Completed", deviceId: claim.deviceId,
    },
  };
}

/** Sign a device out (its sessions end and Clerk signs them out); it stays trusted. */
export async function signOutDevice(accountId: string, deviceId: string, by: "self" | "support"): Promise<ActionResult> {
  const d = await getDevice(accountId, deviceId);
  if (!d || d.trust_state !== "trusted") {
    return { ok: false, status: 404, reason: "That device isn't one of the trusted devices.", event: { action: "devices.sign_out", context: "Refused: no such trusted device.", target: { type: "device", id: deviceId }, result: "Blocked" } };
  }
  const ended = await endDeviceSessions(accountId, deviceId, "signed_out_remotely");
  await revokeClerkSessions(ended);
  return {
    ok: true, status: 200, body: { signedOut: ended.length },
    event: { action: "devices.sign_out", context: `Signed out ${d.name}${by === "support" ? " (by Support)" : ""}; ${ended.length} session(s) ended. It stays trusted.`, target: { type: "device", id: d.id, label: d.name }, result: "Completed" },
  };
}

/** Remove a device (or, for Support, free a slot): no longer trusted, and signed out. */
export async function removeDevice(accountId: string, deviceId: string, by: "self" | "support", action: string): Promise<ActionResult> {
  const d = await getDevice(accountId, deviceId);
  const target = { type: "device", id: deviceId, label: d?.name ?? null };
  if (!d || d.trust_state !== "trusted" || !(await revokeDevice(accountId, deviceId, by === "self" ? "removed" : "freed_by_support"))) {
    return { ok: false, status: 404, reason: "That device isn't one of the trusted devices.", event: { action, context: "Refused: no such trusted device.", target, result: "Blocked" } };
  }
  const ended = await endDeviceSessions(accountId, deviceId, "device_removed");
  await revokeClerkSessions(ended);
  await recordSessionEvent({ accountId, deviceId, type: "device_revoked", description: by === "self" ? `Removed trusted device: ${d.name}.` : `Support freed a device slot: removed ${d.name}.` });
  return {
    ok: true, status: 200, body: { removed: d.id },
    event: {
      action, context: by === "self" ? `Removed trusted device ${d.name}; it was signed out.` : `Freed a device slot: removed ${d.name} and signed it out.`,
      target, previous: "Trusted", next: "Removed", result: "Completed",
    },
  };
}
