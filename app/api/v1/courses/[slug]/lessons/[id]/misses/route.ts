import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { lessonMisses } from "@/lib/activities/review";

// L6, Reviewers: the common misses on a lesson's graded items. Counts and answers only, never who.
export const GET = withCap("courses.verify", async (_req, ctx, account) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const m = await lessonMisses(account, slug, id);
  return m ? ok({ items: m }) : refuse(404, "No such lesson in your courses.");
});
