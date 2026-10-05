import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { decideEdit } from "@/lib/courses/refresh";

/** A Reviewer approves or rejects a suggested edit: { decision: "approve" | "reject" }. Approved edits go into a NEW Draft. */
export const POST = withCap("courses.verify", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await decideEdit(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
