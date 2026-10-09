import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { removeSlot, updateSlot } from "@/lib/courses/videos";

/** C1: edits a slot: title, brief, transcript, lesson. Audited. */
export const PATCH = withCap("courses.videos", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await updateSlot(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});

/** C1: removes a slot with no uploads. Audited. */
export const DELETE = withCap("courses.videos", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await removeSlot(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
