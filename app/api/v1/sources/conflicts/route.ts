import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { listConflicts, openConflict } from "@/lib/sources/claims";

// Source conflicts (L1): the Reviewer queue. GET ?status=open|resolved. POST { claimAId, claimBId, why }: open one by hand.
export const GET = withCap("sources.library.view", async (req) => ok({ conflicts: await listConflicts(new URL(req.url).searchParams.get("status")) }));

export const POST = withCap("sources.claims.manage", async (_req, _ctx, account, x) => {
  const r = await openConflict(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
