import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reorderModules } from "@/lib/courses/editor";

/** C1: reorders the modules of a Draft version. Body: { ids }. Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await reorderModules(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
