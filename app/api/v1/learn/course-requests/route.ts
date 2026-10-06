import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { requestCourse } from "@/lib/path/path";

/**
 * L7: ask for a course on a topic with no published course. Body: { topic, level }. Anonymous: only the topic and level
 * are kept (counted with others who asked the same), and it is recorded by the system, never as this learner.
 */
export const POST = withCap("learn", async (_req, _ctx, _account, x) => {
  const r = await requestCourse(x.body);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
