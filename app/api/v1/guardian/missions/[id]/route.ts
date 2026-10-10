import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { decideApproval } from "@/lib/missions";

/** C2: the Guardian approves or declines a mission request. Body: { decision }. Audited. */
export const POST = withCap("guardian.controls", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await decideApproval(account, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
