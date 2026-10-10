import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setNickname } from "@/lib/leaderboard";

/** C2: an adult picks their leaderboard nickname (never their real name or email). Body: { nickname }. Audited. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await setNickname(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
