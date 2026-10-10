import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setAiSummaries } from "@/lib/notebook";

/** C2: turns the optional AI summaries on or off (off by default). Body: { on }. Audited. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await setAiSummaries(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
