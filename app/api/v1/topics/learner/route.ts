import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { lookupLearner, ownerSetBusiness } from "@/lib/picks/picks";

// L8: the Owner only. Look up a learner's picks by email (?email=).
export const GET = withCap("picks.inspect", async (req) => ok(await lookupLearner(new URL(req.url).searchParams.get("email"))));

/** The Owner changes a learner's business, or releases it (slug null) so they can choose again. Body: { accountId, slug, reason }. */
export const POST = withCap("picks.override", async (_req, _ctx, _account, x) => {
  const r = await ownerSetBusiness(x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
