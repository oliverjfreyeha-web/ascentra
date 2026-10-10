import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setNotices } from "@/lib/courses/capstone";

/** C2: the course's business license and software or AI plan notices (each shown once per course). Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await setNotices(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
