import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { queueRefresh, setRefreshDays } from "@/lib/courses/refresh";

/** The Owner sets the course's refresh interval: { days: 30..60, reason }. */
export const PATCH = withCap("courses.refresh.configure", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await setRefreshDays(account, slug, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});

/** Queue a refresh for the next run (the estimate is shown before). It never changes what learners see. */
export const POST = withCap("courses.refresh.run", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await queueRefresh(account, slug);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
