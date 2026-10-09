import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { editBooster } from "@/lib/courses/boosters";

/** C1: the Owner edits a booster or turns it on or off. Body: any of { name, description, itemTypes, active }. Audited. */
export const PATCH = withCap("courses.boosters", async (_req, ctx, account, x) => {
  const { id } = (await ctx.params) as { id: string };
  const r = await editBooster(account, id, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
