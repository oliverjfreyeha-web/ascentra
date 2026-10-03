import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { approveBlueprint } from "@/lib/courses/blueprint";

/** Approving a Blueprint creates the Draft course version (modules, lessons, skills). No lesson is written yet. */
export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await approveBlueprint(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
