import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { startUpload } from "@/lib/courses/videos";

/** C1: step 1 of an upload: checks size and type, returns a one-time link the browser sends the file to. Body: { name, size, type }. Audited. */
export const POST = withCap("courses.videos", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await startUpload(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
