import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { recordProgress } from "@/lib/courses/learn";

/** Progress on the published version studied. Body: { versionId, status: "in_progress" | "complete" }. Not audited. */
export const POST = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await recordProgress(account, id, x.body);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
