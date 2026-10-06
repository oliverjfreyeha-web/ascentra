import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reviewSafetyEvent } from "@/lib/mentor/safety-queue";

/** Marks a safety event reviewed. Body: { reason } (recorded as the review note). */
export const POST = withCap("safety.review", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await reviewSafetyEvent(account, id, x.reason!);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
