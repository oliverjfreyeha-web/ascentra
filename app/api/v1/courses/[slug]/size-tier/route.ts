import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setSizeTier } from "@/lib/courses/editor";

/** C2: sets a Draft version's size tier (Compact, Standard, Large); the module count must fit. Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await setSizeTier(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
