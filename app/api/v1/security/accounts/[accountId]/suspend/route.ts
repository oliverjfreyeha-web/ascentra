import { withCap } from "@/lib/auth";
import { applyStaffStep } from "@/lib/enforcement";
import { endAllSessions } from "@/lib/sessions";
import { revokeClerkSessions } from "@/lib/device-actions";
import { ok, refuse } from "@/lib/http";
import { loadTargetAccount } from "@/lib/security-view";

// Suspend (Super Admin or the Owner), after a person applied Limit: every session is signed out. Needs a reason.
export const POST = withCap("security.suspend", async (_req, ctx, actor, x) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const target = await loadTargetAccount(accountId);
  if (!target) {
    await x.audit({ action: "security.suspend", context: "Refused: no such account.", target: { type: "account", id: accountId }, result: "Blocked" });
    return refuse(404, "No such account.");
  }
  const r = await applyStaffStep(actor, { id: target.id, roleKey: target.roleKey, label: `${target.displayName} (${target.roleLabel})` }, "suspend", x.reason!);
  if (r.ok) await revokeClerkSessions(await endAllSessions(target.id, "suspended"));
  await x.audit(r.event);
  return r.ok ? ok({ applied: "suspend" }) : refuse(r.status, r.reason);
});
