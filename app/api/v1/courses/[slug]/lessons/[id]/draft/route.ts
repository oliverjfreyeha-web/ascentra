import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { draftLesson } from "@/lib/courses/lessons";

// L2: Claude drafts the lesson as a new Draft version, from the approved Blueprint and its sources.
export const maxDuration = 300;

export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await draftLesson(account, slug, id, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
