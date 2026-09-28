import { withCap } from "@/lib/auth";
import { parseRoleChange } from "@/lib/admin-rules";
import { changeAdminRole, removeAdmin } from "@/lib/admins";
import { recordAuditEvent } from "@/lib/audit";
import { jsonBody, ok, refuse } from "@/lib/http";

// Owner only: change an admin's role (one of ADMIN_ROLES; never "owner").
export const PATCH = withCap("admins.role.change", async (req, ctx, owner) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const parsed = parseRoleChange(await jsonBody(req));
  if (!parsed.ok) {
    await recordAuditEvent({
      type: "capability.refused", actorAccountId: owner.id, targetAccountId: accountId,
      detail: `Role change refused: ${parsed.reason}`,
    });
    return refuse(400, parsed.reason);
  }
  const result = await changeAdminRole(owner, accountId, parsed.value);
  return result.ok ? ok({ changed: true }) : refuse(result.status, result.reason);
});

// Owner only: remove an admin's role.
export const DELETE = withCap("admins.revoke", async (_req, ctx, owner) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const result = await removeAdmin(owner, accountId);
  return result.ok ? ok({ removed: true }) : refuse(result.status, result.reason);
});
