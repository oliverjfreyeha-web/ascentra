/**
 * L4: the Mentor's fixed rules, in code (pure: tested on their own).
 *   - Graded work: a request to write or complete an assessment or assignment answer is refused, with explanation and
 *     hints offered instead (the reference prototype's wording).
 *   - Safety: clear signals of self-harm, abuse or threats get a fixed safety response before any model sees the
 *     message; the model-based screen catches the rest. Teens get the teen safety response.
 *   - Teens (accounts.is_minor): personal details (email, phone, street address, social handle) are removed from their
 *     message before it is stored or sent, and they are told why.
 *   - Limits: a daily message cap per learner (a placeholder the Owner sets with MENTOR_DAILY_CAP), on top of the L1
 *     spend caps.
 *   - The Guardian-alert policy for a teen's safety event is a counsel item: PLACEHOLDER, no alert is sent.
 */

/** PLACEHOLDER (counsel item): whether a teen's Guardian is told about a safety event. "none" until counsel decides. */
export const GUARDIAN_SAFETY_ALERT_POLICY: "none" | "limited_alert" = "none";
export const GUARDIAN_POLICY_LABEL = "PLACEHOLDER (counsel item): the Guardian is not alerted until a policy is set.";

/** PLACEHOLDER: messages a learner can send the Mentor per UTC day. MENTOR_DAILY_CAP (a plain number) overrides it. */
export const MENTOR_DAILY_CAP_DEFAULT = 40;
export function mentorDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MENTOR_DAILY_CAP);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : MENTOR_DAILY_CAP_DEFAULT;
}

export const MAX_MESSAGE_CHARS = 2000;

export type SafetyCategory = "self_harm" | "abuse" | "threat" | "sexual_content" | "violence" | "hate" | "other_harm" | "personal_data";

/** Clear signals only (the floor); the model-based screen catches the rest. */
const SIGNALS: [Exclude<SafetyCategory, "personal_data">, RegExp][] = [
  ["self_harm", /\b(kill(ing)? myself|suicid(e|al)|end(ing)? my life|want(ed)? to die|wish i (was|were) dead|self[- ]?harm|cut(ting)? myself|hurt(ing)? myself)\b/i],
  ["abuse", /\b(abus(e|ed|es|ing) me|sexually abused|molest(ed|ing)?|(hits|beats|hurts|touches) me\b|(hit|beat|touched) me (again|every|when))/i],
  ["threat", /\b(i('m| am)? (going to|gonna|will) (kill|shoot|stab|hurt) (him|her|them|someone|people|everyone)|bring (a|my) (gun|knife|weapon) to (school|class|work))\b/i],
];
export function safetySignal(text: string): SafetyCategory | null {
  for (const [category, re] of SIGNALS) if (re.test(text)) return category;
  return null;
}

/** From the reference prototype: "write / do / finish / complete / answer / solve / fill out … assignment / quiz / …". */
export const GRADED = /\b(write|do|finish|complete|answer|solve|fill (out|in))\b[^.?!]*\b(assignment|capstone|quiz|check|lab|homework|test|rubric|assessment|exam)\b|\bgive me the answers?\b/i;
export const isGradedRequest = (text: string) => GRADED.test(text);

export const GRADED_REFUSAL =
  "I can't do graded work for you. It has to be yours to count as evidence of what you can do. I can explain the idea, show an example from a different situation, or give hints one at a time. Which would help?";
export const NOT_IN_SOURCES =
  "I can't find this in your course's sources, so I won't guess. Try asking about something in this lesson, or check the sources listed under it.";
export const OFF_TOPIC_ADULT =
  "That goes beyond what your course covers, so I can't answer it from course evidence. Ask me about this lesson or another part of your course.";
export const OFF_TOPIC_TEEN =
  "Let's keep to your course. I can explain something from this lesson, give an example, or quiz you on it. What would help?";
export const PERSONAL_DATA_NOTE =
  "I removed some personal details from your message (like an email, phone number or address). You don't need to share those with me.";
export const PAUSED =
  "This conversation is paused after a safety check. You can start a new conversation about your lesson.";

const RESOURCES = {
  crisis: "You can call or text 988 (the Suicide & Crisis Lifeline) any time, day or night, to talk with someone.",
  danger: "If you or someone else is in danger right now, call 911.",
  childAbuse: "You can call or text the Childhelp National Child Abuse Hotline at 1-800-422-4453.",
  adultAbuse: "You can call the National Domestic Violence Hotline at 1-800-799-7233, or text START to 88788.",
};

/** The safety response (teen or adult). It never repeats what the learner wrote. */
export function safetyResponse(category: SafetyCategory, isMinor: boolean): string {
  const open = isMinor
    ? "It sounds like you might be dealing with something hard, and that matters more than this lesson."
    : "It sounds like something serious is going on, and that matters more than this lesson.";
  const lines = [open];
  if (category === "self_harm") lines.push(RESOURCES.crisis, RESOURCES.danger);
  else if (category === "abuse") lines.push(isMinor ? RESOURCES.childAbuse : RESOURCES.adultAbuse, RESOURCES.danger);
  else if (category === "threat" || category === "violence") lines.push(RESOURCES.danger, RESOURCES.crisis);
  else lines.push(RESOURCES.crisis);
  lines.push(isMinor
    ? "Please also talk to a trusted adult, like a parent, guardian, teacher or school counselor. I'm here for your course, and I've paused this conversation."
    : "I'm here to help with your course, not with this, so please reach out to one of those.");
  return lines.join(" ");
}

/** Teens: removes personal details before anything is stored or sent. */
export function redactPersonalData(text: string): { text: string; removed: boolean } {
  let removed = false;
  const sub = (re: RegExp, label: string) => (t: string) => t.replace(re, () => { removed = true; return label; });
  const steps = [
    sub(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]"),
    sub(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]"),
    sub(/\b\d{1,5}\s+(?:[A-Z][a-z]+\s){0,3}(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b\.?/gi, "[address removed]"),
    sub(/(^|\s)@[A-Za-z0-9_.]{3,30}\b/g, " [handle removed]"),
  ];
  const out = steps.reduce((t, f) => f(t), text);
  return { text: out, removed };
}

/** Priority in the review queue: a teen's urgent event first. */
export function safetyPriority(category: SafetyCategory, isMinor: boolean): { priority: 0 | 1 | 2; severity: "urgent" | "standard" } {
  const urgent = category === "self_harm" || category === "abuse" || category === "threat";
  return urgent ? { priority: isMinor ? 0 : 1, severity: "urgent" } : { priority: 2, severity: "standard" };
}

export const CATEGORY_LABEL: Record<SafetyCategory, string> = {
  self_harm: "Self-harm", abuse: "Abuse", threat: "Threat of harm", sexual_content: "Sexual content", violence: "Violence",
  hate: "Hate", other_harm: "Other harm", personal_data: "Personal data",
};
