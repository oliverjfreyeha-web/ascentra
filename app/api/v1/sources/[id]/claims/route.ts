import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { extractClaims } from "@/lib/sources/claims";

/** Extract cited claims from an approved source (AI), then open conflicts with other approved sources. */
export const POST = withCap("sources.claims.manage", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await extractClaims(account, id, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
