import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { createTopic, listTopicsAdmin } from "@/lib/picks/picks";

// L8: the topics learners pick from, with anonymous demand counts (Owner and authorized staff).
export const GET = withCap("topics.view", async () => ok(await listTopicsAdmin()));

/** Add a topic. Body: { kind, name, blurb?, published?, teenHidden?, hasCourse? }. Audited. */
export const POST = withCap("topics.manage", async (_req, _ctx, _account, x) => {
  const r = await createTopic(x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
