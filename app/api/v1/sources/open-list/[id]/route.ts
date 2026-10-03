import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { removeFromOpenList } from "@/lib/sources/library";

/** Remove an entry from the open-license list (Owner only). Body: { reason }. */
export const DELETE = withCap("sources.open_list.edit", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await removeFromOpenList(account, id);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
