import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { requestDeletion } from "@/lib/privacy";

/** Request deletion (B4). Body: { forAccountId?, note? }. Tracked with a due date and audited. */
export const POST = withCap("privacy.delete.request", async (_req, _ctx, account, x) => {
  const r = await requestDeletion(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
