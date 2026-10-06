import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { getPath, reorderPath } from "@/lib/path/path";

// L7: the learner's path: published courses in order, why each was chosen, time and last verified.
export const GET = withCap("learn", async (_req, _ctx, account) => ok(await getPath(account)));

/** Reorder. Body: { order: [slug, ...] }. */
export const PATCH = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await reorderPath(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
