import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { exportData } from "@/lib/privacy";

/** Download my data as JSON (B4). Body: { forAccountId? } (a Guardian, for their teen). Recorded and audited. */
export const POST = withCap("privacy.export", async (_req, _ctx, account, x) => {
  const r = await exportData(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
