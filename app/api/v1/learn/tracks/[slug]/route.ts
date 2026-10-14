import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { trackView } from "@/lib/progress/track-view";

/** S1: a skill track for the learner: Rounds and their sections, with what is open, done and why something is locked. */
export const GET = withCap("learn", async (_req, ctx, account) => {
  const { slug } = (await ctx.params) as { slug: string };
  const t = await trackView(account, slug);
  return t ? ok(t) : refuse(404, "No such track.");
});
