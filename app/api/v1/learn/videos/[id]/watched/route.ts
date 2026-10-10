import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { videoWatched } from "@/lib/progress/learner";

/** C2: a video watched to the end counts as done (once). Only for an open item. */
export const POST = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await videoWatched(account, id);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
