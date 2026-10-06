import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { removeFromPath } from "@/lib/path/path";

/** L7: remove a course from the path. */
export const DELETE = withCap("learn", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await removeFromPath(account, slug);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
