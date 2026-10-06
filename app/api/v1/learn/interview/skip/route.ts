import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { skipInterview } from "@/lib/path/path";

/** L7: skip the interview for now (it can be taken any time from the path page). */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await skipInterview(account);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
