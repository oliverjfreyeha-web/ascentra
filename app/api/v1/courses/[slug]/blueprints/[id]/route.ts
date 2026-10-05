import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { editBlueprint } from "@/lib/courses/blueprint";

/** A person edits a Draft Blueprint. Body: { plan }. */
export const PATCH = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await editBlueprint(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
