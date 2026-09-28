import { withCap } from "@/lib/auth";
import { removeDevice } from "@/lib/device-actions";
import { ok, refuse } from "@/lib/http";

// Remove one of your trusted devices: it's signed out and its slot is free.
export const DELETE = withCap("devices.manage", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await removeDevice(account.id, id, "self", "devices.remove");
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
