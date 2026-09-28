import { withCap } from "@/lib/auth";
import { replaceDevice } from "@/lib/device-actions";
import { ok, refuse } from "@/lib/http";

/**
 * A device past the limit takes the slot of one the person picks. Sensitive: Clerk re-checks the
 * second factor first (withCap). Audited, and counted by the sharing tracker.
 */
export const POST = withCap("devices.replace", async (req, _ctx, account, x) => {
  const replaceId = typeof x.body.replace === "string" ? x.body.replace : "";
  if (!/^[0-9a-f-]{36}$/i.test(replaceId)) return refuse(400, "Choose the device to replace.");
  const r = await replaceDevice({ req, account, device: x.device, enforcement: x.enforcement, replaceId, clerkSessionId: x.sessionId, requestId: x.requestId });
  await x.audit(r.event);
  if (!r.ok) return refuse(r.status, r.reason);
  const res = ok(r.body);
  if (r.setCookie) res.headers.append("Set-Cookie", r.setCookie);
  return res;
}, { device: "any" });
