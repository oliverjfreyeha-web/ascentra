import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setItemPart } from "@/lib/courses/editor";

/** C1: sets a Draft item's part of the recipe. Body: { part, booster? }. Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await setItemPart(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
