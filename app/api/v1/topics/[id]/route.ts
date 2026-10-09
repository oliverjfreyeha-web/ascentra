import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { updateTopic } from "@/lib/picks/picks";

/** L8: edit, publish or unpublish a topic, set teen_hidden or has_course. Body: any of { name, blurb, published, teenHidden, hasCourse }. Audited. */
export const PATCH = withCap("topics.manage", async (_req, ctx, _account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await updateTopic(id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
