import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { publishVersion } from "@/lib/courses/lessons";

/** A verified version in Review -> Published. Needs a reason and a recent second factor. Body: { reason }. */
export const POST = withCap("courses.release", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await publishVersion(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
