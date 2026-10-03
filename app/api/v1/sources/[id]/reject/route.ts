import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { decideSource } from "@/lib/sources/library";

/** Reject a source. Body: { reason }. An owner-supplied source is approved by the Owner. */
export const POST = withCap("sources.library.decide", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await decideSource(account, id, "rejected");
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
