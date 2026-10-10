import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { checkLearnerCapstone, learnerCapstone } from "@/lib/courses/capstone";

/** C2: the learner's capstone for a course: deliverables, self-check, Automation with AI (business courses). */
export const GET = withCap("learn", async (_req, ctx, account) => {
  const { courseId } = (await ctx.params) as { courseId: string };
  const c = await learnerCapstone(account, courseId);
  return c ? ok(c) : refuse(404, "This course has no capstone.");
});

/** C2: Body: { checked: { [key]: boolean } }. Every deliverable and check ticked: the capstone is done. */
export const PUT = withCap("learn", async (_req, ctx, account, x) => {
  const { courseId } = (await ctx.params) as { courseId: string };
  const r = await checkLearnerCapstone(account, courseId, x.body);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
