import { withCap } from "@/lib/auth";
import { revokeInvite } from "@/lib/admins";
import { ok, refuse } from "@/lib/http";

// Owner only: revoke an invite before it becomes an active role. Needs a reason.
export const DELETE = withCap("admins.revoke", async (_req, ctx, owner, { audit }) => {
  const { id } = (await ctx.params) as { id: string };
  const result = await revokeInvite(owner, id);
  await audit(result.event);
  return result.ok ? ok({ revoked: true }) : refuse(result.status, result.reason);
});
