/**
 * C1: the income-claims check. Courses never promise or imply income, earnings, profit or results. Any text in a course
 * version (module titles, lesson text, practice items, video briefs) that reads as such a claim blocks the version from
 * going to review, and the check says exactly what and where. Pure: tested on its own, with what should and shouldn't
 * match (tests/unit/course-structure.test.ts). A price for a service ("charge $500 a month for the retainer") isn't a claim;
 * a promise of what the learner will make is.
 */

const MONEY = String.raw`\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m)\b)?`;
const PER = String.raw`(?:\/|\s?(?:a|per|each|every)\s)\s?(?:month|mo|week|wk|day|year|yr|hour|hr)`;

/** Each pattern, with a plain name for the finding. Case-insensitive. */
export const INCOME_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "a promise to make or earn money", re: new RegExp(String.raw`\b(?:make|earn|bring in|generate|clear|net|pull in|rake in|take home)\s+(?:up to\s+|over\s+|at least\s+|an extra\s+|more than\s+)?${MONEY}`, "i") },
  { name: "a dollar amount presented as income", re: new RegExp(String.raw`${MONEY}\s?(?:${PER})?\s+(?:in\s+)?(?:income|profit|profits|passive|revenue|salary|take-home|earnings)\b`, "i") },
  { name: "an earnings promise", re: /\b(?:you(?:'ll| will| can| could)|learners? (?:will|can))\s+(?:easily\s+)?(?:make|earn|profit)\b/i },
  { name: "passive income", re: /\bpassive income\b/i },
  { name: "guaranteed results", re: /\bguarantee(?:d|s)?\s+(?:results?|income|profits?|returns?|earnings|sales|clients|success|money)\b/i },
  { name: "get rich", re: /\bget(?:ting)? rich\b/i },
  { name: "six or seven figures", re: /\b(?:six|seven|6|7)[- ]figures?\b/i },
  { name: "financial freedom", re: /\bfinancial(?:ly)? (?:freedom|free|independen(?:ce|t))\b/i },
  { name: "quit your job", re: /\bquit (?:your|their) (?:day )?jobs?\b/i },
  { name: "replace your income", re: /\breplace (?:your|their) (?:income|salary|paycheck)\b/i },
  { name: "make money fast", re: /\bmake money (?:fast|quickly|while you sleep|on autopilot|overnight)\b/i },
  { name: "a multiple of income", re: /\b\d+x (?:your|their) (?:income|revenue|earnings|money)\b/i },
  { name: "earning potential", re: /\b(?:earning|income) potential\b/i },
];

export type Finding = { where: string; text: string; claim: string; excerpt: string };

/** Every claim in one piece of text: the words matched and a short excerpt around them. */
export function findIncomeClaims(text: string): { claim: string; text: string; excerpt: string }[] {
  const out: { claim: string; text: string; excerpt: string }[] = [];
  if (!text) return out;
  for (const p of INCOME_PATTERNS) {
    const re = new RegExp(p.re.source, "gi");
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const start = Math.max(0, at - 40);
      const end = Math.min(text.length, at + m[0].length + 40);
      out.push({ claim: p.name, text: m[0], excerpt: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` });
    }
  }
  return out;
}

/** Runs the check over labelled pieces of text ("Module 2 › Lesson 'Pricing' › paragraph 3") and lists every finding. */
export function scanTexts(pieces: { where: string; text: string | null | undefined }[]): Finding[] {
  return pieces.flatMap((p) => findIncomeClaims(p.text ?? "").map((f) => ({ where: p.where, ...f })));
}

/** Text out of any JSON value (lesson bodies, item content, briefs), each string once. */
export function textsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (value && typeof value === "object") return Object.entries(value).filter(([k]) => !/^(sourceId|claimId|url|ref|refs|id)$/.test(k)).flatMap(([, v]) => textsOf(v));
  return [];
}

export const INCOME_BLOCK = "This course version can't go to review: some of its text reads as a promise of income or results. Reword each place listed.";

type LessonLike = { summary?: string; sections?: { heading: string; paragraphs: { text: string }[] }[]; takeaways?: { text: string }[] } | null | undefined;

/** The check over one lesson version, each place labelled the way the editor shows it. */
export function lessonFindings(title: string, body: LessonLike, at = "This lesson"): Finding[] {
  return scanTexts([
    { where: `${at} › title`, text: title },
    { where: `${at} › summary`, text: body?.summary },
    ...(body?.sections ?? []).flatMap((s, si) => [
      { where: `${at} › section ${si + 1} heading`, text: s.heading },
      ...s.paragraphs.map((p, pi) => ({ where: `${at} › section ${si + 1} "${s.heading}" › paragraph ${pi + 1}`, text: p.text })),
    ]),
    ...(body?.takeaways ?? []).map((t, ti) => ({ where: `${at} › takeaway ${ti + 1}`, text: t.text })),
  ]);
}

/** A refusal reason that lists the first findings: the exact words and where they are. */
export function incomeReason(findings: Finding[], max = 3): string {
  const shown = findings.slice(0, max).map((f) => `${f.where}: "${f.text}" (${f.claim})`).join("; ");
  return `${INCOME_BLOCK} ${shown}${findings.length > max ? `; and ${findings.length - max} more` : ""}.`;
}
