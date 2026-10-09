import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reorderLessons } from "@/lib/courses/editor";

/** C1: reorders a module's lessons. Body: { ids }. Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await reorderLessons(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
