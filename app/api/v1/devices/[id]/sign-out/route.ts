import { withCap } from "@/lib/auth";
import { signOutDevice } from "@/lib/device-actions";
import { ok, refuse } from "@/lib/http";

// Sign one of your devices out. It stays trusted.
export const POST = withCap("devices.manage", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await signOutDevice(account.id, id, "self");
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
