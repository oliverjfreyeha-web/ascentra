import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { courseActivities } from "@/lib/activities/review";

// L6: the course's activity library for the Reviewer: items by module and lesson, counts by type and level, the variety
// rule per module, and the diff of a refreshed draft against the item it would replace.
export const GET = withCap("courses.view", async (_req, ctx, account) => {
  const { slug } = (await ctx.params) as { slug: string };
  const c = await courseActivities(account, slug);
  return c ? ok(c) : refuse(404, "No such course.");
});
