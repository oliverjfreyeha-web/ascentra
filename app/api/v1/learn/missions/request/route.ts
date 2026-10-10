import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { requestApproval } from "@/lib/missions";

/** C2: a teen asks their Guardian to approve real-world missions in a course, or one contact mission. Body: { itemId, scope }. Audited. */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await requestApproval(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
