import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { learnerLesson } from "@/lib/courses/learn";

/** The published version of a lesson, with its citations and "last verified" date. Nothing else, to anyone. */
export const GET = withCap("learn", async (_req, ctx, account) => {
  const { id } = (await ctx.params) as { id: string };
  const l = await learnerLesson(account, id);
  return l ? ok(l) : refuse(404, "No such lesson.");
});
