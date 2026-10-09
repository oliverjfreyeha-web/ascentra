import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { approveModule, sendBackModule } from "@/lib/courses/owner-review";

/**
 * C1: the Owner's decision on a module: { decision: "approve" } or { decision: "send_back", note }. Sending back returns
 * its versions in Review to Draft with the note shown. Insert-only and audited.
 */
export const POST = withCap("courses.owner_review", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  if (x.body.decision !== "approve" && x.body.decision !== "send_back") return refuse(400, "Choose approve or send back with a note.");
  const r = x.body.decision === "approve" ? await approveModule(account, slug, id) : await sendBackModule(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
