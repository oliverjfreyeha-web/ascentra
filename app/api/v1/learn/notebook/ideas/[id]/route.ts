import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { deleteIdea, editIdea } from "@/lib/notebook";

/** C2: edits one of the learner's ideas. Body: { body }. */
export const PATCH = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await editIdea(account, id, x.body);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});

/** C2: deletes one of the learner's ideas. */
export const DELETE = withCap("learn", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await deleteIdea(account, id);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
