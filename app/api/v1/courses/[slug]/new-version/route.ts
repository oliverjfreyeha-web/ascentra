import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { newVersion } from "@/lib/courses/editor";

/** C1: starts a new Draft version of a live course (an edit never changes the live one). Audited. */
export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await newVersion(account, slug);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
