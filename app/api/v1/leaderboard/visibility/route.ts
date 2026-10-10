import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setOptOut } from "@/lib/leaderboard";

/** C2: the clear opt-out from the leaderboard. Body: { optOut }. Audited. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await setOptOut(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
