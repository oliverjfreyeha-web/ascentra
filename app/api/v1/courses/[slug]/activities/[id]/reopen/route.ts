import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reopenItem } from "@/lib/courses/editor";

/** C1: an approved item of a Draft version goes back to Draft to be edited (reviewed again). Audited. */
export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await reopenItem(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
