import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { publishCourse, unpublishCourse } from "@/lib/courses/owner-review";

/**
 * C1: the Owner publishes the course (every module approved by the Owner) or unpublishes it (hidden from new learners;
 * learners who started keep access and progress). Body: { reason }. Sensitive: the second factor is re-checked. Audited.
 */
export const POST = withCap("courses.publish_course", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await publishCourse(account, slug);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});

export const DELETE = withCap("courses.publish_course", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await unpublishCourse(account, slug, { note: x.reason });
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
