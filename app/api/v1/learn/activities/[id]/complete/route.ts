import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { completeActivity } from "@/lib/progress/learner";

/** C2: a practice task, assignment or sandbox marked done after trying it (teen missions are checked first). */
export const POST = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await completeActivity(account, id);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
