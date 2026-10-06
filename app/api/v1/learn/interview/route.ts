import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { deleteInterview, getInterview, saveInterview } from "@/lib/path/path";

// L7: the interview. Four questions from fixed lists; the answers are private to the learner (never in the audit log).
export const GET = withCap("learn", async (_req, _ctx, account) => ok(await getInterview(account)));

/** Answer (or redo) the interview; the path is rebuilt from published courses. Body: { goal, level, minutesPerWeek, topics, interests }. */
export const PUT = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await saveInterview(account, x.body, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});

/** Deletes the learner's answers and their path. */
export const DELETE = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await deleteInterview(account);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
