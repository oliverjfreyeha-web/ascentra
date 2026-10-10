import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { summarize } from "@/lib/notebook";

/** C2: an AI summary of the learner's auto-notes (course text only), when turned on; limited per day; spend caps apply. */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await summarize(account, x.requestId);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
