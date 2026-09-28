import { withCap } from "@/lib/auth";
import { removeDevice } from "@/lib/device-actions";
import { ok, refuse } from "@/lib/http";
import { loadTargetAccount } from "@/lib/security-view";

// Support frees a device slot: the device is removed and signed out. Needs a reason.
// Nobody but the Owner changes the Owner's devices.
export const DELETE = withCap("support.device.free", async (_req, ctx, actor, x) => {
  const { accountId, deviceId } = (await ctx.params) as { accountId: string; deviceId: string };
  const target = await loadTargetAccount(accountId);
  const t = { type: "account", id: accountId, label: target ? `${target.displayName} (${target.roleLabel})` : accountId };
  if (!target) {
    await x.audit({ action: "support.device.free", context: "Refused: no such account.", target: t, result: "Blocked" });
    return refuse(404, "No such account.");
  }
  if (target.roleKey === "owner" && actor.roleKey !== "owner") {
    await x.audit({ action: "support.device.free", context: "Refused: only the Owner changes the Owner's devices.", target: t, result: "Blocked" });
    return refuse(403, "Only the Owner changes the Owner's devices.");
  }
  const r = await removeDevice(accountId, deviceId, "support", "support.device.free");
  await x.audit({ ...r.event, context: `${r.event.context} Account: ${t.label}.` });
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
