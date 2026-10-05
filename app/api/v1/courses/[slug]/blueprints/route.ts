import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { generateBlueprint } from "@/lib/courses/blueprint";

// L2: Claude proposes a Blueprint from approved sources. Body: { title, topic, audience, sourceIds, researchRunIds? }.
export const maxDuration = 300;

export const POST = withCap("courses.build", async (_req, ctx, account, x) => {
  const { slug } = (await ctx.params) as { slug: string };
  const r = await generateBlueprint(account, slug, x.body, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
