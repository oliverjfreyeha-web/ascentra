import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { queueTopics } from "@/lib/catalog";

/**
 * L6: batch generation. Body: { slugs, confirm?, expectedTotalUsd? }. Without confirm: the whole batch's cost estimate
 * (nothing queued, nothing recorded). With confirm and the same total: queued for the overnight run, and audited.
 */
export const POST = withCap("catalog.queue", async (_req, _ctx, account, x) => {
  const r = await queueTopics(account, x.body);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
