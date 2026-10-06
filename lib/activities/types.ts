/**
 * L6: the activity library's item types, as pure functions (tested on their own).
 *   Graded by code, against the answer key a Reviewer approved: multiple choice, true/false, matching, ordering, and the
 *   flashcard self-check (the learner says whether they knew the back; the check is recorded by code, not judged by AI).
 *   Feedback only, never a grade: short answer, build-it exercise with a checklist, branching scenario, spot-the-mistake,
 *   case teardown, teach-it-back, mini-project checklist. Their "reveal" (a sample answer, key points, the mistake...)
 *   is shown after the learner tries; their answers are not stored and never count toward scores or progress.
 */
export const CODE_TYPES = ["multiple_choice", "true_false", "matching", "ordering", "flashcard"] as const;
export const FEEDBACK_TYPES = ["short_answer", "build_it", "branching_scenario", "spot_the_mistake", "case_teardown", "teach_back", "mini_project"] as const;
export const ITEM_TYPES = [...CODE_TYPES, ...FEEDBACK_TYPES] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export type Grading = "code" | "feedback";
export const LEVELS = ["beginner", "intermediate"] as const;
export type Level = (typeof LEVELS)[number];
export const MIN_MODULE_TYPES = 3;

export const gradingOf = (t: ItemType): Grading => ((CODE_TYPES as readonly string[]).includes(t) ? "code" : "feedback");
export const isItemType = (v: unknown): v is ItemType => typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);

export const TYPE_LABEL: Record<ItemType, string> = {
  multiple_choice: "Multiple choice", true_false: "True or false", matching: "Matching", ordering: "Ordering", flashcard: "Flashcard self-check",
  short_answer: "Short answer", build_it: "Build-it exercise", branching_scenario: "Branching scenario", spot_the_mistake: "Spot the mistake",
  case_teardown: "Case teardown", teach_back: "Teach it back", mini_project: "Mini-project",
};
export const PRACTICE_LABEL = "Practice, not graded";

/** Content keys shown before an attempt; the rest of `content` (feedback types) is revealed after it. */
const SHOWN: Record<ItemType, string[]> = {
  multiple_choice: ["options"], true_false: [], matching: ["left", "right"], ordering: ["steps"], flashcard: ["front"],
  short_answer: [], build_it: ["checklist"], branching_scenario: ["options"], spot_the_mistake: ["passage"], case_teardown: ["caseText", "questions"],
  teach_back: [], mini_project: ["checklist"],
};

export type Content = Record<string, unknown>;
export type AnswerKey = Record<string, unknown> | null;
type Str = string;
const strs = (v: unknown, min: number, max: number, each = 300): v is Str[] =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every((s) => typeof s === "string" && s.trim().length > 0 && s.length <= each);
const str = (v: unknown, max = 2000): v is Str => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const perm = (v: unknown, n: number) => Array.isArray(v) && v.length === n && [...v].sort((a, b) => a - b).every((x, i) => x === i);

/** Whether the content and the answer key are complete for the type (null when fine, else what's wrong). */
export function checkItem(type: ItemType, content: Content, key: AnswerKey): string | null {
  if (gradingOf(type) === "code" ? !key : key) return gradingOf(type) === "code" ? "A code-graded item needs an answer key." : "A feedback-only item has no answer key.";
  switch (type) {
    case "multiple_choice":
      return strs(content.options, 2, 6) && Number.isInteger(key!.correct) && (key!.correct as number) >= 0 && (key!.correct as number) < (content.options as Str[]).length
        ? null : "Give 2 to 6 options and the correct one.";
    case "true_false":
      return typeof key!.correct === "boolean" ? null : "Say whether the statement is true or false.";
    case "matching":
      return strs(content.left, 2, 6) && strs(content.right, 2, 6) && (content.left as Str[]).length === (content.right as Str[]).length && perm(key!.pairs, (content.left as Str[]).length)
        ? null : "Give 2 to 6 pairs, with each left item matched to one right item.";
    case "ordering":
      return strs(content.steps, 3, 7) && perm(key!.order, (content.steps as Str[]).length) ? null : "Give 3 to 7 steps and their correct order.";
    case "flashcard":
      return str(content.front, 300) && str(key!.back, 600) ? null : "Give the front and the back of the card.";
    case "short_answer":
      return str(content.sampleAnswer) ? null : "Give a sample answer to show after the learner tries.";
    case "build_it":
    case "mini_project":
      return strs(content.checklist, 2, 10) ? null : "Give a checklist of 2 to 10 steps.";
    case "branching_scenario":
      return Array.isArray(content.options) && content.options.length >= 2 && content.options.length <= 4
        && content.options.every((o: unknown) => !!o && typeof o === "object" && str((o as Content).text, 300) && str((o as Content).outcome, 600) && ["strong", "workable", "weak"].includes((o as Content).fit as string))
        ? null : "Give 2 to 4 choices, each with an outcome and how well it fits.";
    case "spot_the_mistake":
      return str(content.passage) && str(content.mistake, 600) ? null : "Give the passage and the mistake in it.";
    case "case_teardown":
      return str(content.caseText) && strs(content.questions, 1, 5) && strs(content.keyPoints, 1, 8) ? null : "Give the case, 1 to 5 questions and the key points.";
    case "teach_back":
      return strs(content.keyPoints, 1, 8) ? null : "Give the key points a good explanation covers.";
  }
}

/** What a learner sees before trying: never the answer key, never the reveal. */
export function learnerContent(type: ItemType, content: Content): Content {
  const shown: Content = {};
  for (const k of SHOWN[type]) if (k in content) shown[k] = k === "options" && type === "branching_scenario"
    ? (content.options as { text: string }[]).map((o) => ({ text: o.text })) : content[k];
  return shown;
}

/** What is revealed after a feedback-only attempt (labeled practice). */
export function revealOf(type: ItemType, content: Content): Content {
  const out: Content = {};
  for (const [k, v] of Object.entries(content)) if (!SHOWN[type].includes(k) || (type === "branching_scenario" && k === "options")) out[k] = v;
  return out;
}

const sameArray = (a: unknown, b: unknown) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Grades a code-graded item against its answer key. Returns null when the answer isn't in the expected form. Pure.
 *   multiple_choice { choice }, true_false { value }, matching { pairs }, ordering { order }, flashcard { knew }.
 */
export function grade(type: ItemType, key: AnswerKey, answer: unknown): { correct: boolean; answer: unknown; correctAnswer: unknown } | null {
  if (gradingOf(type) !== "code" || !key || !answer || typeof answer !== "object") return null;
  const a = answer as Content;
  switch (type) {
    case "multiple_choice":
      return Number.isInteger(a.choice) ? { correct: a.choice === key.correct, answer: a.choice, correctAnswer: key.correct } : null;
    case "true_false":
      return typeof a.value === "boolean" ? { correct: a.value === key.correct, answer: a.value, correctAnswer: key.correct } : null;
    case "matching":
      return Array.isArray(a.pairs) && a.pairs.every(Number.isInteger) ? { correct: sameArray(a.pairs, key.pairs), answer: a.pairs, correctAnswer: key.pairs } : null;
    case "ordering":
      return Array.isArray(a.order) && a.order.every(Number.isInteger) ? { correct: sameArray(a.order, key.order), answer: a.order, correctAnswer: key.order } : null;
    case "flashcard":
      // A self-check: the learner saw the back and says whether they knew it. Recorded, not judged.
      return typeof a.knew === "boolean" ? { correct: a.knew, answer: a.knew, correctAnswer: key.back } : null;
    default:
      return null;
  }
}

/** A stable shuffle (by a seed string), so the shown order of matching and ordering items doesn't give the answer. */
export function seededOrder(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  // Never the identity order when there is a choice.
  if (n > 1 && idx.every((x, i) => x === i)) idx.push(idx.shift()!);
  return idx;
}

/** Plain lines of an item, for the diff a Reviewer sees after a refresh. */
export function itemLines(i: { item_type: string; level: string; goal: string; prompt: string; content: Content; answer_key: AnswerKey; explanation: string; citation: { title?: string } }): string[] {
  return [
    `Type: ${TYPE_LABEL[i.item_type as ItemType] ?? i.item_type} (${i.level})`, `Goal: ${i.goal}`, `Prompt: ${i.prompt}`,
    ...Object.entries(i.content).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
    ...(i.answer_key ? [`Answer key: ${JSON.stringify(i.answer_key)}`] : []),
    `Explanation: ${i.explanation}`, `Source: ${i.citation?.title ?? "(none)"}`,
  ];
}

/** The variety rule for a module: its distinct activity types among the given items. */
export function varietyOf(items: { item_type: string }[]): { types: number; ok: boolean } {
  const types = new Set(items.map((i) => i.item_type)).size;
  return { types, ok: types >= MIN_MODULE_TYPES };
}
