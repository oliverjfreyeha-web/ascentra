import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { pause } from "@/lib/picks/picks";

/** L8: set a pick aside (kept, paused). Body: { slug }. A locked business can't be set aside. */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await pause(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
