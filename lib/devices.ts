import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { DEVICE_LIMIT } from "@/lib/security-config";

/**
 * Trusted devices (prototype: TrustedDevice, "Devices and security").
 *
 * A device is a browser profile: a random value in an HttpOnly cookie, set by POST /api/v1/session.
 * Only its SHA-256 is stored. A private (Incognito) window gets a fresh cookie, so it is a new device
 * each time it's opened after all private windows were closed.
 * Stored per device: a name and kind from the browser's user agent, an approximate region, trust dates.
 * Never stored: IP address, precise location, the cookie value.
 */

export const DEVICE_COOKIE = "__Host-ascentra_device";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers keep a cookie

export const newDeviceToken = () => randomBytes(32).toString("base64url");
export const deviceKeyHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const deviceCookie = (token: string) =>
  `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;

export function readDeviceToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === DEVICE_COOKIE) {
      const value = v.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
  }
  return null;
}

export type DeviceKind = "laptop" | "desktop" | "phone" | "tablet" | "other";

/** A plain name like "Chrome on Windows" and a kind, from the user agent. Good enough to recognise a device. */
export function describeDevice(ua: string | null): { name: string; kind: DeviceKind } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  if (/iPhone/.test(s)) return { name: `${browser} on iPhone`, kind: "phone" };
  if (/iPad/.test(s)) return { name: `${browser} on iPad`, kind: "tablet" };
  if (/Android/.test(s)) return /Mobile/.test(s) ? { name: `${browser} on Android phone`, kind: "phone" } : { name: `${browser} on Android tablet`, kind: "tablet" };
  if (/CrOS/.test(s)) return { name: `${browser} on Chromebook`, kind: "laptop" };
  if (/Macintosh|Mac OS X/.test(s)) return { name: `${browser} on Mac`, kind: "laptop" };
  if (/Windows/.test(s)) return { name: `${browser} on Windows`, kind: "desktop" };
  if (/Linux/.test(s)) return { name: `${browser} on Linux`, kind: "desktop" };
  return { name: browser === "Browser" ? "Unknown device" : browser, kind: "other" };
}

export type ApproxLocation = { region: string | null; lat: number | null; lon: number | null };

/**
 * An approximate region ("WA, US") and whole-degree coordinates from Vercel's geolocation headers.
 * The IP address itself is never read.
 */
export function approxLocation(headers: Headers): ApproxLocation {
  const clean = (v: string | null) => (v ? decodeURIComponent(v).replace(/[^\p{L}\p{N} .,-]/gu, "").slice(0, 40) : "");
  const region = [clean(headers.get("x-vercel-ip-country-region")), clean(headers.get("x-vercel-ip-country"))].filter(Boolean).join(", ");
  const num = (v: string | null, max: number) => {
    const n = Number.parseFloat(v ?? "");
    return Number.isFinite(n) && Math.abs(n) <= max ? Math.round(n) : null;
  };
  const lat = num(headers.get("x-vercel-ip-latitude"), 90);
  const lon = num(headers.get("x-vercel-ip-longitude"), 180);
  return { region: region || null, lat: lat != null && lon != null ? lat : null, lon: lat != null && lon != null ? lon : null };
}

export type DeviceRow = {
  id: string;
  account_id: string;
  name: string;
  kind: DeviceKind;
  trust_state: "trusted" | "pending_verification" | "revoked";
  approx_region: string | null;
  last_seen_at: string | null;
  trusted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** The request's device: its cookie key and, if that key is trusted for this account, the device row. */
export type RequestDevice = { token: string | null; keyHash: string | null; device: DeviceRow | null };

export async function resolveDevice(req: Request, accountId: string): Promise<RequestDevice> {
  const token = readDeviceToken(req);
  if (!token) return { token: null, keyHash: null, device: null };
  const keyHash = deviceKeyHash(token);
  const { data, error } = await getDb()
    .from("trusted_devices")
    .select("*")
    .eq("account_id", accountId)
    .eq("device_key_hash", keyHash)
    .eq("trust_state", "trusted")
    .maybeSingle();
  if (error) throw new Error(`device lookup failed: ${error.message}`);
  return { token, keyHash, device: (data as DeviceRow | null) ?? null };
}

export async function listTrustedDevices(accountId: string): Promise<DeviceRow[]> {
  const { data, error } = await getDb()
    .from("trusted_devices")
    .select("*")
    .eq("account_id", accountId)
    .eq("trust_state", "trusted")
    .order("trusted_at", { ascending: true });
  if (error) throw new Error(`device list failed: ${error.message}`);
  return (data ?? []) as DeviceRow[];
}

export async function getDevice(accountId: string, deviceId: string): Promise<DeviceRow | null> {
  const { data, error } = await getDb().from("trusted_devices").select("*").eq("id", deviceId).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`device lookup failed: ${error.message}`);
  return (data as DeviceRow | null) ?? null;
}

export type ClaimOutcome = "existing" | "registered" | "replaced" | "full" | "not_found";

/** Registers (or, with replaceId, swaps in) a device, atomically against DEVICE_LIMIT (public.claim_device_slot). */
export async function claimDeviceSlot(p: {
  accountId: string; keyHash: string; name: string; kind: DeviceKind; region: string | null; replaceId?: string | null; limit?: number;
}): Promise<{ outcome: ClaimOutcome; deviceId: string | null; replacedId: string | null }> {
  const { data, error } = await getDb().rpc("claim_device_slot", {
    p_account: p.accountId, p_key_hash: p.keyHash, p_name: p.name, p_kind: p.kind, p_region: p.region,
    p_limit: p.limit ?? DEVICE_LIMIT, p_replace: p.replaceId ?? null,
  });
  if (error) throw new Error(`device claim failed: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as { outcome: ClaimOutcome; device_id: string | null; replaced_id: string | null };
  return { outcome: r.outcome, deviceId: r.device_id, replacedId: r.replaced_id };
}

/** Stops trusting a device. Its sessions are ended by the caller (lib/sessions), which also signs them out. */
export async function revokeDevice(accountId: string, deviceId: string, reason: "removed" | "freed_by_support"): Promise<boolean> {
  const { data, error } = await getDb()
    .from("trusted_devices")
    .update({ trust_state: "revoked", revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("id", deviceId)
    .eq("account_id", accountId)
    .eq("trust_state", "trusted")
    .select("id");
  if (error) throw new Error(`device removal failed: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

export async function recordSessionEvent(e: {
  accountId: string; deviceId: string | null; type: "sign_in_held" | "device_added" | "device_revoked" | "device_replaced";
  description: string; region?: string | null; clerkSessionId?: string | null;
}): Promise<void> {
  const { error } = await getDb().from("session_events").insert({
    account_id: e.accountId, trusted_device_id: e.deviceId, event_type: e.type, description: e.description,
    approx_region: e.region ?? null, clerk_session_id: e.clerkSessionId ?? null,
  });
  if (error) throw new Error(`session event failed: ${error.message}`);
}
