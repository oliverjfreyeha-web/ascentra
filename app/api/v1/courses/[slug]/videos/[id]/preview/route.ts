import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { previewLink } from "@/lib/courses/videos";

/** C1: a ten-minute link for the Owner to watch the uploaded video before approving it. */
export const GET = withCap("courses.videos", async (_req, ctx, account) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const p = await previewLink(account, slug, id);
  return p ? ok(p) : refuse(404, "No video to preview.");
});
