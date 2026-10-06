import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { askMentor, mentorInfo } from "@/lib/mentor/mentor";

// L4: ask the Mentor about a published lesson. Body: { lessonId, message, threadId? }. Not audited: the audit log never
// holds Mentor content; the conversation is stored only in the learner's private thread.
export const maxDuration = 60;

export const POST = withCap("learn", async (_req, _ctx, account, x) => {
  const r = await askMentor(account, x.body, x.requestId);
  return r.ok ? ok({ ...r.body, mentor: await mentorInfo(account) }, r.status) : refuse(r.status, r.reason);
});
