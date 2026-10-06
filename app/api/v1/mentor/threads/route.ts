import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { deleteThreads, listThreads, mentorInfo } from "@/lib/mentor/mentor";

/** The learner's own Mentor conversations (?lessonId= to narrow). Nobody else's, whatever the role. */
export const GET = withCap("learn", async (req, _ctx, account) =>
  ok({ threads: await listThreads(account, new URL(req.url).searchParams.get("lessonId")), mentor: await mentorInfo(account) }));

/** Deletes all of the learner's own Mentor conversations (Privacy Center). */
export const DELETE = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await deleteThreads(account, null);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
