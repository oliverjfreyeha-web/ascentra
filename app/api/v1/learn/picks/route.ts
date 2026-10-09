import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { getChooser, pick } from "@/lib/picks/picks";

// L8: "Choose your path": the five questions, businesses (best matches first), skills, and the plan's limits.
export const GET = withCap("learn", async (_req, _ctx, account) => ok(await getChooser(account)));

/** Pick a business or a skill. Body: { slug }. The plan's limits are enforced by the database, atomically. */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await pick(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
