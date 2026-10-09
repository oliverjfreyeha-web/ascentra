import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addModule } from "@/lib/courses/editor";

/** C1: adds a module (a course has 5 or 6). Body: { title }. Audited. */
export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await addModule(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
