import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setActivityMode } from "@/lib/path/path";

/** L7: practice picked for the learner, or the default set. Body: { mode: "personal" | "default" }. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await setActivityMode(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
