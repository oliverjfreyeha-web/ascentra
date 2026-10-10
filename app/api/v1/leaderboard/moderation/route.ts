import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { removeNickname } from "@/lib/leaderboard";

/** C2: the Owner removes a nickname. Body: { nickname, reason }. Audited. */
export const POST = withCap("leaderboard.moderate", async (_req, _ctx, account, x) => {
  const r = await removeNickname(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
