import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setTimeZone } from "@/lib/progress/learner";

/** C2: the learner's time zone (their day, for the streak, ends at their midnight). Body: { timeZone }. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await setTimeZone(account, x.body);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
