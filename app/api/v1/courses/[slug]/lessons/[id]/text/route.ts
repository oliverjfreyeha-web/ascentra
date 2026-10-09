import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { editLessonText } from "@/lib/courses/editor";

/** C1: edits a lesson's Draft text by hand (citations kept); checked for income claims. Audited. */
export const PATCH = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await editLessonText(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
