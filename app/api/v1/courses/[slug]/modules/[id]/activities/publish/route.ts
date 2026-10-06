import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { publishModule } from "@/lib/activities/review";

/** L6: publishes a module's approved practice items, only with at least 3 different activity types. */
export const POST = withCap("courses.release", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await publishModule(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
