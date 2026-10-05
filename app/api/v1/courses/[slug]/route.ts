import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { courseDetail } from "@/lib/courses/admin";

// L2: one course in the builder: Blueprints (with sources and outdated notes), lessons and their versions with diffs.
export const GET = withCap("courses.view", async (_req, ctx, account) => {
  const { slug } = (await ctx.params) as { slug: string };
  const d = await courseDetail(account, slug);
  return d ? ok(d) : refuse(404, "No such course (or it isn't assigned to you).");
});
