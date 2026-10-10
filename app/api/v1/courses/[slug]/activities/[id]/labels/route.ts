import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setItemLabels } from "@/lib/courses/editor";

/** C2: a Draft item's importance label, Notebook note and mission type. Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await setItemLabels(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
