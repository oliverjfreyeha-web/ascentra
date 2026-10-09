import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { removeModule, updateModule } from "@/lib/courses/editor";

/** C1: edits a module: title, stage, recipe, pace. Audited. */
export const PATCH = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await updateModule(account, slug, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});

/** C1: removes an empty module (never below 5). Audited. */
export const DELETE = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug, id } = (await ctx.params) as { slug: string; id: string };
  const r = await removeModule(account, slug, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
