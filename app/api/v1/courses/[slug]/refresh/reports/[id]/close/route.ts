import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { closeReport } from "@/lib/courses/refresh";

/** A Reviewer closes a change report: { note }. The course is verified as of today; its refresh clock restarts. */
export const POST = withCap("courses.verify", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await closeReport(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
