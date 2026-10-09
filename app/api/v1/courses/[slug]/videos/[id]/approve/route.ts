import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { approveSlot } from "@/lib/courses/videos";

/** C1: the Owner approves an uploaded video (a transcript is required). Audited. */
export const POST = withCap("courses.videos", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await approveSlot(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
