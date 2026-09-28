import { withCap } from "@/lib/auth";
import { parseInviteRequest } from "@/lib/admin-rules";
import { createInvite } from "@/lib/admins";
import { recordAuditEvent } from "@/lib/audit";
import { jsonBody, ok, refuse } from "@/lib/http";

// Owner only: invite a new admin with exactly one of ADMIN_ROLES.
export const POST = withCap("admins.invite", async (req, _ctx, owner) => {
  const parsed = parseInviteRequest(await jsonBody(req));
  if (!parsed.ok) {
    await recordAuditEvent({ type: "capability.refused", actorAccountId: owner.id, detail: `Invite refused: ${parsed.reason}` });
    return refuse(400, parsed.reason);
  }
  const result = await createInvite(owner, parsed.value);
  return result.ok ? ok({ invite: result.value }, 201) : refuse(result.status, result.reason);
});
