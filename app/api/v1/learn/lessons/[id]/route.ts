import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { learnerLesson } from "@/lib/courses/learn";
import { lessonActivities, lessonScore } from "@/lib/activities/learn";

/**
 * The lesson a learner reads, with its citations and "last verified" date: the version they studied (with an "updated"
 * notice when a newer one is published), or ?view=current. Only published or archived versions, to anyone.
 */
export const GET = withCap("learn", async (req, ctx, account) => {
  const { id } = (await ctx.params) as { id: string };
  const l = await learnerLesson(account, id, { view: new URL(req.url).searchParams.get("view") });
  // L6: the lesson's published practice items (never a Draft), and the score from code-graded items only.
  // L7: the items shown are the ones picked for the learner (with why), or the default set.
  if (!l) return refuse(404, "No such lesson.");
  const practice = await lessonActivities(account, id);
  return ok({ ...l, activities: practice.activities, selection: practice.selection, score: await lessonScore(account, id) });
});
