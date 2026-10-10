import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { allowList, setAllowList } from "@/lib/missions";

/** C2: the Owner's state allow-list per mission type (off for teens everywhere until turned on). */
export const GET = withCap("missions.view", async () => ok(await allowList()));

/** C2: Body: { missionType, state, teensAllowed, reason }. Audited. */
export const PUT = withCap("missions.allowlist", async (_req, _ctx, account, x) => {
  const r = await setAllowList(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
