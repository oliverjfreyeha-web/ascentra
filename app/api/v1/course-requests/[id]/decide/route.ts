import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { decideRequest } from "@/lib/path/path";

/** L7: mark a course request planned, dismissed or open again. Body: { status, reason }. Audited with the reason. */
export const POST = withCap("course_requests.manage", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await decideRequest(account, id, x.body, x.reason ?? "");
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
