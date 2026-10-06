import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { editItem } from "@/lib/activities/review";

/** L6: a Reviewer edits a Draft item (its citation stays). Audited with the previous and new text. */
export const PATCH = withCap("courses.verify", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await editItem(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
