import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { learnerLesson } from "@/lib/courses/learn";

/**
 * The lesson a learner reads, with its citations and "last verified" date: the version they studied (with an "updated"
 * notice when a newer one is published), or ?view=current. Only published or archived versions, to anyone.
 */
export const GET = withCap("learn", async (req, ctx, account) => {
  const { id } = (await ctx.params) as { id: string };
  const l = await learnerLesson(account, id, { view: new URL(req.url).searchParams.get("view") });
  return l ? ok(l) : refuse(404, "No such lesson.");
});
