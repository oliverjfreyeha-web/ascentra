import { withCap } from "@/lib/auth";
import { applyStaffStep } from "@/lib/enforcement";
import { ok, refuse } from "@/lib/http";
import { loadTargetAccount } from "@/lib/security-view";

// Limit (Support or the Owner): no new devices or replacements for LIMIT_HOURS. Needs a reason.
export const POST = withCap("security.limit", async (_req, ctx, actor, x) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const target = await loadTargetAccount(accountId);
  if (!target) {
    await x.audit({ action: "security.limit", context: "Refused: no such account.", target: { type: "account", id: accountId }, result: "Blocked" });
    return refuse(404, "No such account.");
  }
  const r = await applyStaffStep(actor, { id: target.id, roleKey: target.roleKey, label: `${target.displayName} (${target.roleLabel})` }, "limit", x.reason!);

  await x.audit(r.event);
  return r.ok ? ok({ applied: "limit" }) : refuse(r.status, r.reason);
});
