import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { deleteThreads, getThread } from "@/lib/mentor/mentor";

/** One of the learner's own conversations; anyone else gets "not found". */
export const GET = withCap("learn", async (_req, ctx, account) => {
  const { id } = (await ctx.params) as { id: string };
  const t = await getThread(account, id);
  return t ? ok({ thread: t }) : refuse(404, "No such conversation of yours.");
});

export const DELETE = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await deleteThreads(account, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
