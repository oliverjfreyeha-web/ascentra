import { withCap } from "@/lib/auth";
import { parseRoleChange } from "@/lib/admin-rules";
import { changeAdminRole, removeAdmin } from "@/lib/admins";
import { ok, refuse } from "@/lib/http";

// Owner only: change an admin's role (one of ADMIN_ROLES; never "owner"). Needs a reason.
export const PATCH = withCap("admins.role.change", async (_req, ctx, owner, { body, audit }) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const parsed = parseRoleChange(body);
  if (!parsed.ok) {
    await audit({
      action: "admins.role.change", context: `Refused: ${parsed.reason}`, result: "Blocked",
      target: { type: "account", id: accountId, label: accountId }, next: typeof body.role === "string" ? body.role : null,
    });
    return refuse(400, parsed.reason);
  }
  const result = await changeAdminRole(owner, accountId, parsed.value);
  await audit(result.event);
  return result.ok ? ok({ changed: true }) : refuse(result.status, result.reason);
});

// Owner only: remove an admin's role. Needs a reason.
export const DELETE = withCap("admins.revoke", async (_req, ctx, owner, { audit }) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const result = await removeAdmin(owner, accountId);
  await audit(result.event);
  return result.ok ? ok({ removed: true }) : refuse(result.status, result.reason);
});
