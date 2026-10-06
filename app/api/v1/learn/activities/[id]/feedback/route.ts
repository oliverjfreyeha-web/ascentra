import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { practiceFeedback } from "@/lib/activities/learn";

// L6: AI feedback on a practice answer (never a grade), counted against the learner's Mentor allowance. Not audited and
// not stored: like the Mentor, what the learner wrote stays out of the logs.
export const maxDuration = 60;

export const POST = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await practiceFeedback(account, id, x.body, x.requestId);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
