import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addClaim, listClaims } from "@/lib/sources/claims";

// Claims (L1). GET ?sourceId=: claims with their citations. POST { claim, sourceId?, citedText? }: add one by hand.
export const GET = withCap("sources.library.view", async (req) => ok({ claims: await listClaims(new URL(req.url).searchParams.get("sourceId")) }));

export const POST = withCap("sources.claims.manage", async (_req, _ctx, account, x) => {
  const r = await addClaim(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
