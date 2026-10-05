import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { listResearch, runResearch } from "@/lib/courses/research";

// L2: research a topic with live web search. What it finds is added to the source library as PROPOSED.
export const maxDuration = 300;

export const GET = withCap("sources.research", async () => ok({ runs: await listResearch() }));

/** Body: { topic, audience: "beginner" | "intermediate" | "advanced", freshness? }. */
export const POST = withCap("sources.research", async (_req, _ctx, account, x) => {
  const r = await runResearch(account, x.body, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
