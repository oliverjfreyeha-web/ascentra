import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { startTopicCourse } from "@/lib/picks/picks";

/**
 * C1: starts a topic's course: links the topic to the catalog and queues the research, Blueprint and drafting steps as a
 * v2 course. Body: { confirm?, expectedTotalUsd? }: first the estimate (nothing recorded), then the confirmed total (audited).
 */
export const POST = withCap("catalog.queue", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await startTopicCourse(account, id, x.body);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
