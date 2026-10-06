import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { draftPool } from "@/lib/activities/draft";

// L6: Claude drafts a pool of practice items for the lesson, from its approved sources, as Draft items.
export const maxDuration = 300;

export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await draftPool(account, slug, id, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
