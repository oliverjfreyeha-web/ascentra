import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { cancelJob } from "@/lib/catalog";

/** L6: take a topic off the batch queue (anything already drafted stays as Draft). */
export const POST = withCap("catalog.queue", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await cancelJob(account, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
