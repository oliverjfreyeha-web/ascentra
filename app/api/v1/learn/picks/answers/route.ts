import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { saveAnswers } from "@/lib/picks/picks";

/** L8: the five answers, from fixed lists, on the learner's profile. Body: { goal, hours, experience, style, camera }. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await saveAnswers(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
