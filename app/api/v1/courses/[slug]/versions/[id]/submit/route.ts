import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { submitVersion } from "@/lib/courses/lessons";

/** Draft -> Review. */
export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await submitVersion(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
