import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addSlot } from "@/lib/courses/videos";

/** C1: adds a video slot to a module (up to 4). Body: { moduleId, title }. Audited. */
export const POST = withCap("courses.videos", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await addSlot(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
