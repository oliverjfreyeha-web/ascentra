import { withCap } from "@/lib/auth";
import { decideAppeal } from "@/lib/enforcement";
import { ok, refuse } from "@/lib/http";

// Decide an appeal: accept (the step is lifted) or decline (it stays). Needs a reason.
export const POST = withCap("support.appeal.decide", async (_req, ctx, actor, x) => {
  const { id } = (await ctx.params) as { id: string };
  const decision = x.body.decision;
  if (decision !== "accept" && decision !== "decline") {
    await x.audit({ action: "support.appeal.decide", context: "Refused: the decision must be accept or decline.", target: { type: "appeal", id }, result: "Blocked" });
    return refuse(400, "The decision must be accept or decline.");
  }
  const r = await decideAppeal(actor, id, decision, x.reason!);
  await x.audit(r.event);
  return r.ok ? ok({ decided: decision }) : refuse(r.status, r.reason);
});
