import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { learnerVideoLink } from "@/lib/courses/videos";

/**
 * C1: a learner's short-lived link to an approved video of a lesson they may open (never a public link; teen-hidden and
 * unpublished courses are checked). Not audited: it's reading a lesson.
 */
export const GET = withCap("learn", async (_req, ctx, account) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await learnerVideoLink(account, id);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
