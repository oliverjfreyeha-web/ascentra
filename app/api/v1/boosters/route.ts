import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addBooster, listBoosters } from "@/lib/courses/boosters";

/** C1: the list of learning boosters (anyone who builds courses sees it). */
export const GET = withCap("courses.view", async () => ok(await listBoosters()));

/** C1: the Owner adds a booster. Body: { name, description, itemTypes }. Audited. */
export const POST = withCap("courses.boosters", async (_req, _ctx, account, x) => {
  const r = await addBooster(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
