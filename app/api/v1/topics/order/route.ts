import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reorderTopics } from "@/lib/picks/picks";

/** L8: reorder one kind of topic. Body: { kind, order: [slug, ...] }. Audited. */
export const PUT = withCap("topics.manage", async (_req, _ctx, _account, x) => {
  const r = await reorderTopics(x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
