import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reviewItem } from "@/lib/activities/review";

/** L6: a Reviewer approves or rejects a Draft item. Body: { decision: "approve" | "reject", note }. */
export const POST = withCap("courses.verify", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await reviewItem(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
