import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { courseStudio } from "@/lib/courses/owner-review";

/**
 * C1: the course studio: the latest version module by module (recipe and how far it's met, lessons, practice by part,
 * video slots), the income-claims check, each module's Owner decision, and whether the course can be published.
 */
export const GET = withCap("courses.view", async (_req, ctx, account) => {
  const { slug } = (await ctx.params) as { slug: string };
  const s = await courseStudio(account, slug);
  return s ? ok(s) : refuse(404, "No such course (or it isn't assigned to you).");
});
