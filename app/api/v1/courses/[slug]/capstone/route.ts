import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { capstoneView, setCapstone } from "@/lib/courses/capstone";

/** C2: the course's capstone and notices (latest version). */
export const GET = withCap("courses.view", async (_req, ctx) => {
  const { slug } = (await ctx.params) as { slug: string };
  const c = await capstoneView(slug);
  return c ? ok(c) : refuse(404, "No such course.");
});

/** C2: sets the capstone of a Draft version (deliverables, self-check, Automation with AI for business courses). Audited. */
export const PUT = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await setCapstone(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
