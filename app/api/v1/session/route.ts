import { withCap } from "@/lib/auth";
import { registerDevice, summarize } from "@/lib/device-actions";
import { approxLocation, listTrustedDevices } from "@/lib/devices";
import { ok, refuse } from "@/lib/http";
import { DEVICE_LIMIT, HEARTBEAT_SECONDS } from "@/lib/security-config";
import { publicEnforcement } from "@/lib/security-view";
import { OTHER_DEVICE_NOTICE, heartbeat } from "@/lib/sessions";

/**
 * The heartbeat every signed-in page sends (on load, then every HEARTBEAT_SECONDS while visible).
 * Registers the device on its first verified sign-in while a slot is free, starts or keeps the
 * session, and tells the page what to show: the device-limit screen, the other-device notice,
 * a safeguard step, or nothing.
 */
export const POST = withCap("self.view", async (req, _ctx, account, x) => {
  if (!x.sessionId) return refuse(400, "No session.");
  const base = { heartbeatSeconds: HEARTBEAT_SECONDS, deviceLimit: DEVICE_LIMIT, enforcement: publicEnforcement(x.enforcement) };
  if (x.enforcement.suspended) return ok({ ...base, device: null, session: null });

  const reg = await registerDevice({ req, accountId: account.id, device: x.device, enforcement: x.enforcement, clerkSessionId: x.sessionId });
  let res: Response;
  if (!reg.trusted) {
    res = ok({ ...base, device: { trusted: false, name: reg.name, why: reg.why }, devices: reg.devices.map((d) => summarize(d, null)), session: null });
  } else {
    if (reg.registered) {
      await x.audit({
        action: "devices.register", context: `Trusted a new device on its first verified sign-in: ${reg.device.name}.`,
        target: { type: "device", id: reg.device.id, label: reg.device.name }, next: "Trusted", result: "Completed", deviceId: reg.device.id,
      });
    }
    const session = await heartbeat({ accountId: account.id, deviceId: reg.device.id, clerkSessionId: x.sessionId, loc: approxLocation(req.headers), requestId: x.requestId });
    const names = new Map((await listTrustedDevices(account.id)).map((d) => [d.id, d.name]));
    res = ok({
      ...base,
      device: { trusted: true, ...summarize(reg.device, reg.device.id) },
      // R1: a short notice when this request added the browser ("now one of your trusted devices: 2 of 3").
      added: reg.registered ? { name: reg.device.name, count: names.size } : null,
      session: {
        ...session,
        notice: session.conflict || session.state === "paused" ? OTHER_DEVICE_NOTICE : null,
        others: session.others.map((o) => ({ ...o, device: names.get(o.deviceId) ?? "Another device" })),
      },
    });
  }
  if (reg.setCookie) res.headers.append("Set-Cookie", reg.setCookie);
  return res;
}, { device: "any", allowSuspended: true });
