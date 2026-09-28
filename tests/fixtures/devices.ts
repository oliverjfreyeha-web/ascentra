import { createHash } from "node:crypto";

/** A stable device cookie per account, and the trusted_devices row that makes it trusted. */
export const DEVICE_COOKIE = "__Host-ascentra_device";
export const deviceToken = (accountId: string, n = 0) => createHash("sha256").update(`${accountId}:${n}`).digest("base64url");
export const deviceCookie = (accountId: string, n = 0) => `${DEVICE_COOKIE}=${deviceToken(accountId, n)}`;
export const deviceHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const deviceIdFor = (accountId: string, n = 0) => `dev-${accountId.slice(-4)}-${n}`;

export function trustedDeviceRow(accountId: string, n = 0, at = "2026-09-01T00:00:00.000Z") {
  return {
    id: deviceIdFor(accountId, n), account_id: accountId, name: `Device ${n}`, kind: "laptop", trust_state: "trusted",
    approx_region: null, last_seen_at: at, trusted_at: at, created_at: at, revoked_at: null, device_key_hash: deviceHash(deviceToken(accountId, n)),
  };
}
