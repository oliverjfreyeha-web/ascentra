import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addIdea } from "@/lib/notebook";

/** C2: a new idea in "My ideas" (private). Body: { body }. */
export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await addIdea(account, x.body);
  if (r.event.context) await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
