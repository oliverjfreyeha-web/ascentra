/**
 * L4: how the pages read the Mentor and safety APIs: each reader takes a response body exactly as the route sends it and
 * returns the typed value, or null when the shape isn't the one expected. tests/integration/mentor.test.ts passes the
 * real routes' answers through every reader.
 */
export type MentorCitation = { ref: number; sourceId: string; title: string; url: string | null };
export type MentorMessage = {
  role: "learner" | "mentor"; text: string; at: string;
  kind?: "answer" | "not_in_sources" | "graded_refusal" | "off_topic" | "safety" | "paused"; citations?: MentorCitation[]; note?: string | null;
};
/** L5: the allowance meter. line is "Mentor allowance: used X of Y, resets on DATE" (null for staff, who are exempt). */
export type MentorAllowance = {
  status: "exempt" | "none" | "active" | "used_up"; usedUsd: number; usableUsd: number; resetsAt: string | null; trial: boolean;
  line: string | null; canChange: boolean;
};
export type MentorInfo = { aiOn: boolean; dailyCap: number; allowance: MentorAllowance };
export type MentorReply = { thread: { id: string; status: string; title?: string | null }; reply: MentorMessage; mentor: MentorInfo };
export type MentorThreadSummary = { id: string; lessonId: string | null; title: string | null; status: string; messages: number; lastMessageAt: string | null; createdAt: string };
export type MentorThread = { id: string; lessonId: string | null; title: string | null; status: string; messages: MentorMessage[]; createdAt: string };
export type SafetyEvent = {
  id: string; category: string; categoryLabel: string; severity: string; priority: number; stage: string | null; teen: boolean; actions: string[];
  guardianPolicy: string | null; status: "open" | "reviewed"; reviewNote: string | null; reviewedAt: string | null; createdAt: string;
  subject: { id: string; name: string | null; email: string | null };
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const isAllowance = (a: unknown): a is MentorAllowance =>
  obj(a) && str(a.status) && typeof a.usedUsd === "number" && typeof a.usableUsd === "number" && typeof a.canChange === "boolean" && (a.line === null || str(a.line));
const isInfo = (m: unknown): m is MentorInfo => obj(m) && typeof m.aiOn === "boolean" && typeof m.dailyCap === "number" && isAllowance(m.allowance);
const isMessage = (m: unknown): m is MentorMessage => obj(m) && (m.role === "learner" || m.role === "mentor") && str(m.text);

export function mentorReplyFrom(body: unknown): MentorReply | null {
  return obj(body) && obj(body.thread) && str(body.thread.id) && isMessage(body.reply) && isInfo(body.mentor) ? (body as unknown as MentorReply) : null;
}
export function mentorThreadsFrom(body: unknown): { threads: MentorThreadSummary[]; mentor: MentorInfo } | null {
  return obj(body) && arr(body.threads) && body.threads.every((t) => obj(t) && str(t.id)) && isInfo(body.mentor)
    ? (body as unknown as { threads: MentorThreadSummary[]; mentor: MentorInfo }) : null;
}
export function mentorThreadFrom(body: unknown): MentorThread | null {
  return obj(body) && obj(body.thread) && str(body.thread.id) && arr(body.thread.messages) && body.thread.messages.every(isMessage) ? (body.thread as unknown as MentorThread) : null;
}
export function safetyEventsFrom(body: unknown): SafetyEvent[] | null {
  return obj(body) && arr(body.events) && body.events.every((e) => obj(e) && str(e.id) && str(e.category) && arr(e.actions) && obj(e.subject))
    ? (body.events as SafetyEvent[]) : null;
}
