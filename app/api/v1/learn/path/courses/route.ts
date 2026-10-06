import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addToPath } from "@/lib/path/path";

/** L7: add a published course to the path. Body: { slug }. Basic: one subject; Pro: up to 5 (checked on the server). */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await addToPath(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
