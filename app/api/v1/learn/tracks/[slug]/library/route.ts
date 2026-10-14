import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { trackLibrary } from "@/lib/progress/track-view";

/** S1: every lesson the learner can open in a skill track, read-only (locked lessons aren't listed). */
export const GET = withCap("learn", async (_req, ctx, account) => {
  const { slug } = (await ctx.params) as { slug: string };
  const t = await trackLibrary(account, slug);
  return t ? ok(t) : refuse(404, "No such track.");
});
