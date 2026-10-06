import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { attemptItem } from "@/lib/activities/learn";

/** L6: a learner tries a published practice item. Graded by code at once, or "Practice, not graded". */
export const POST = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await attemptItem(account, id, x.body);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
