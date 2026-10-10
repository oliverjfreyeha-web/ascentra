import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { setState, stateOf } from "@/lib/missions";

/** C2: the learner's own US state, for their Account page (private: the learner, the server and authorized staff only). */
export const GET = withCap("self.view", async (_req, _ctx, account) => ok({ state: await stateOf(account.id) }));

/** C2: the learner's US state (private: the learner, the server and authorized staff only). Body: { state }. Audited without the state itself. */
export const PUT = withCap("self.view", async (_req, _ctx, account, x) => {
  const r = await setState(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
