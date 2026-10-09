import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { confirmUpload } from "@/lib/courses/videos";

/** C1: step 2: the file is checked by its content and size, then becomes the slot's video (the old one is kept). Audited. */
export const POST = withCap("courses.videos", async (_req, ctx, account, x) => {
  const { slug, id, uploadId } = (await ctx.params) as { slug: string; id: string; uploadId: string };
  const r = await confirmUpload(account, slug, id, uploadId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
