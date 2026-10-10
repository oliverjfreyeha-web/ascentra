/**
 * L1/L2: AI settings. Every model and embedding call goes through lib/ai (the orchestration service), which reads these.
 * The cheapest model that does each job well:
 *   - claims.extract: short factual claims with a verbatim quote, from one passage at a time → Claude Haiku 4.5.
 *   - conflicts.detect: does claim A contradict claim B (yes/no + why) → Claude Haiku 4.5.
 *   - sources.research (L2): web search, then list cited findings and what has become outdated → Claude Haiku 4.5
 *     with the web search tool (the answer's citations come from the API, not from the model's memory).
 *   - courses.blueprint (L2): structure modules, lessons and skills around cited claims → Claude Sonnet 5.5 (a
 *     course outline is planning, which Haiku does noticeably worse), at medium effort to hold cost down.
 *   - lessons.draft (L2): write a lesson in its own words with inline citations → Claude Sonnet 5.5, medium effort.
 *   - courses.refresh.research (L3): what changed in the field since the last verification, with web search → Haiku 4.5.
 *   - mentor.screen (L4): safety and graded-work check of each message and each reply → Haiku 4.5 (a short classification).
 *   - mentor.answer (L4): answer from numbered course passages, with citations, or say the sources don't cover it →
 *     Haiku 4.5 (grounded question answering over given text; the system prompt and the thread are cached).
 *   - courses.refresh.report (L3): which lesson paragraphs are now doubtful, and cited replacement text → Sonnet 5.5,
 *     medium effort (it rewrites lesson text, which Haiku does noticeably worse).
 *   - activities.draft (L6): a pool of practice items for one lesson, each from a numbered passage, with an answer key
 *     for the code-graded types → Haiku 4.5 (short structured items from given text; the sources are a cached block).
 *   - activities.feedback (L6): feedback on a practice answer (never a grade) → Haiku 4.5.
 *   - paths.rank (L7): order a few published courses for a learner's four interview answers, with one-line reasons →
 *     Haiku 4.5 (a short ranking; it gets the answers and the course list only, never who the learner is).
 *   - notebook.summary (C2): an optional summary of a learner's own auto-notes (course text only; never their "My ideas"
 *     journal or who they are) → Haiku 4.5. Off unless the learner turns it on.
 *   - embeddings: Voyage AI voyage-3.5-lite (Anthropic has no embeddings endpoint; Voyage is the one its docs use).
 * Spend caps are a Owner decision: the values here are PLACEHOLDERS. AI_DAILY_CAP_USD / AI_MONTHLY_CAP_USD (plain
 * numbers, not secrets) override them without a code change.
 */
export const AI_MODELS = {
  "claims.extract": "claude-haiku-4-5",
  "conflicts.detect": "claude-haiku-4-5",
  "sources.research": "claude-haiku-4-5",
  "courses.blueprint": "claude-sonnet-5-5",
  "lessons.draft": "claude-sonnet-5-5",
  "courses.refresh.research": "claude-haiku-4-5",
  "courses.refresh.report": "claude-sonnet-5-5",
  "mentor.screen": "claude-haiku-4-5",
  "mentor.answer": "claude-haiku-4-5",
  "activities.draft": "claude-haiku-4-5",
  "activities.feedback": "claude-haiku-4-5",
  "paths.rank": "claude-haiku-4-5",
  "notebook.summary": "claude-haiku-4-5",
} as const;

/** Effort for the steps on models that take it (Sonnet 5.5): medium holds cost down without losing structure. */
export const AI_EFFORT: Partial<Record<AiPurposeKey, "low" | "medium" | "high">> = { "courses.blueprint": "medium", "lessons.draft": "medium", "courses.refresh.report": "medium" };
type AiPurposeKey = keyof typeof AI_MODELS;

/** The web search tool (L2 research). Billed per search on top of tokens. Basic version: Haiku 4.5 supports it. */
export const WEB_SEARCH = { type: "web_search_20250305", maxUses: 5, usdPerSearch: 0.01 } as const;
export type AiPurpose = keyof typeof AI_MODELS;

/** The model the health check asks about (GET /v1/models/{id}: free, proves the key works). */
export const HEALTH_MODEL = "claude-haiku-4-5";

export const EMBEDDING = { provider: "voyage", model: "voyage-3.5-lite", dimensions: 1024, url: "https://api.voyageai.com/v1/embeddings" } as const;

/** PLACEHOLDER caps, in US dollars, counted from ai_calls (UTC day and month). */
export const SPEND_CAPS_USD = { perDay: 5, perMonth: 50 } as const;

/** Per million tokens, in US dollars (Anthropic and Voyage list prices). Cache writes 1.25x input, reads 0.1x. */
export const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "voyage-3.5-lite": { input: 0.02, output: 0, cacheWrite: 0, cacheRead: 0 },
};

export function costUsd(model: string, u: { input?: number; output?: number; cacheWrite?: number; cacheRead?: number; webSearches?: number }): number {
  const p = PRICES[model];
  const search = (u.webSearches ?? 0) * WEB_SEARCH.usdPerSearch;
  if (!p) return Math.round(search * 1_000_000) / 1_000_000;
  const usd = ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output + (u.cacheWrite ?? 0) * p.cacheWrite + (u.cacheRead ?? 0) * p.cacheRead) / 1_000_000 + search;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Budgets per step for the estimate shown before a run (L2): tokens are upper-end guesses (search results and
 * thinking count as tokens), so the estimate errs high. Real costs are logged per call in ai_calls.
 */
export const STEP_BUDGETS = {
  research: { purpose: "sources.research", input: 40_000, output: 4_000, webSearches: WEB_SEARCH.maxUses },
  blueprint: { purpose: "courses.blueprint", input: 25_000, output: 10_000, webSearches: 0 },
  lesson: { purpose: "lessons.draft", input: 20_000, output: 10_000, webSearches: 0 },
  refreshResearch: { purpose: "courses.refresh.research", input: 40_000, output: 4_000, webSearches: WEB_SEARCH.maxUses },
  refreshReport: { purpose: "courses.refresh.report", input: 30_000, output: 10_000, webSearches: 0 },
  mentorScreen: { purpose: "mentor.screen", input: 2_000, output: 200, webSearches: 0 },
  mentorAnswer: { purpose: "mentor.answer", input: 8_000, output: 1_000, webSearches: 0 },
  activityPool: { purpose: "activities.draft", input: 20_000, output: 8_000, webSearches: 0 },
  activityFeedback: { purpose: "activities.feedback", input: 3_000, output: 500, webSearches: 0 },
  pathRank: { purpose: "paths.rank", input: 4_000, output: 600, webSearches: 0 },
  notebookSummary: { purpose: "notebook.summary", input: 6_000, output: 700, webSearches: 0 },
} as const;

/** L4: one Mentor message, upper end: two safety screens (message and reply) and the answer, unrounded. */
export const mentorEstimate = () => {
  const screen = costUsd(AI_MODELS["mentor.screen"], { input: STEP_BUDGETS.mentorScreen.input, output: STEP_BUDGETS.mentorScreen.output });
  const answer = costUsd(AI_MODELS["mentor.answer"], { input: STEP_BUDGETS.mentorAnswer.input, output: STEP_BUDGETS.mentorAnswer.output });
  return Math.round((screen * 2 + answer) * 10_000) / 10_000;
};

/** L6: lessons assumed per course for a batch estimate, before its Blueprint exists (PLACEHOLDER, upper end). */
export const CATALOG_LESSONS_ESTIMATE = 12;
/** L6: one topic through the batch pipeline: research, a Blueprint, every lesson drafted once, and a pool per lesson. */
export function topicEstimate(lessons = CATALOG_LESSONS_ESTIMATE) {
  const c = courseEstimate(lessons);
  return Math.round((c.total + estimateUsd("activityPool", Math.max(1, lessons))) * 100) / 100;
}
/** L6: one practice-feedback request, unrounded (counted against the Mentor allowance). */
export const feedbackEstimate = () => costUsd(AI_MODELS["activities.feedback"], { input: STEP_BUDGETS.activityFeedback.input, output: STEP_BUDGETS.activityFeedback.output });

/** L3: one course's refresh (a research pass and a change report). */
export const refreshEstimate = () => Math.round((estimateUsd("refreshResearch") + estimateUsd("refreshReport")) * 100) / 100;
export type Step = keyof typeof STEP_BUDGETS;

export function estimateUsd(step: Step, count = 1): number {
  const b = STEP_BUDGETS[step];
  const one = costUsd(AI_MODELS[b.purpose], { input: b.input, output: b.output, webSearches: b.webSearches });
  return Math.round(one * Math.max(1, count) * 100) / 100;
}

/** The whole course: one research run, one blueprint, and every lesson drafted once. */
export function courseEstimate(lessons: number) {
  const research = estimateUsd("research");
  const blueprint = estimateUsd("blueprint");
  const perLesson = estimateUsd("lesson");
  const n = Math.max(0, Math.floor(lessons));
  return { research, blueprint, perLesson, lessons: n, total: Math.round((research + blueprint + perLesson * n) * 100) / 100 };
}

export function spendCaps(source: Record<string, string | undefined> = process.env) {
  const num = (v: string | undefined, d: number) => {
    const n = v == null || v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return { perDay: num(source.AI_DAILY_CAP_USD, SPEND_CAPS_USD.perDay), perMonth: num(source.AI_MONTHLY_CAP_USD, SPEND_CAPS_USD.perMonth) };
}

/** Server secrets for AI, optional: without ANTHROPIC_API_KEY AI is off; without VOYAGE_API_KEY search is full-text only. */
export const AI_ENV_VARS = ["ANTHROPIC_API_KEY", "VOYAGE_API_KEY"] as const;
