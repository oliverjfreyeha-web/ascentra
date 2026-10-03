import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { decideConflict } from "@/lib/sources/claims";

/** AuthorityDecision (L1): { chosenClaimId, decision, reason }. The reason is recorded as the rationale. */
export const POST = withCap("sources.conflicts.decide", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await decideConflict(account, id, x.body, x.reason!);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
