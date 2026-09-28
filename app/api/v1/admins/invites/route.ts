import { withCap } from "@/lib/auth";
import { parseInviteRequest } from "@/lib/admin-rules";
import { createInvite } from "@/lib/admins";
import { ok, refuse } from "@/lib/http";

// Owner only: invite a new admin with exactly one of ADMIN_ROLES. Needs a reason.
export const POST = withCap("admins.invite", async (_req, _ctx, owner, { body, audit }) => {
  const parsed = parseInviteRequest(body);
  if (!parsed.ok) {
    await audit({ action: "admins.invite", context: `Refused: ${parsed.reason}`, result: "Blocked" });
    return refuse(400, parsed.reason);
  }
  const result = await createInvite(owner, parsed.value);
  await audit(result.event);
  return result.ok ? ok({ invite: result.value }, 201) : refuse(result.status, result.reason);
});
