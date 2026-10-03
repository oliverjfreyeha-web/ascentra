/**
 * L1: AI settings. Every model and embedding call goes through lib/ai (the orchestration service), which reads these.
 * The cheapest model that does each job well:
 *   - claims.extract: short factual claims with a verbatim quote, from one passage at a time → Claude Haiku 4.5.
 *   - conflicts.detect: does claim A contradict claim B (yes/no + why) → Claude Haiku 4.5.
 *   - embeddings: Voyage AI voyage-3.5-lite (Anthropic has no embeddings endpoint; Voyage is the one its docs use).
 * Spend caps are a Owner decision: the values here are PLACEHOLDERS. AI_DAILY_CAP_USD / AI_MONTHLY_CAP_USD (plain
 * numbers, not secrets) override them without a code change.
 */
export const AI_MODELS = {
  "claims.extract": "claude-haiku-4-5",
  "conflicts.detect": "claude-haiku-4-5",
} as const;
export type AiPurpose = keyof typeof AI_MODELS;

/** The model the health check asks about (GET /v1/models/{id}: free, proves the key works). */
export const HEALTH_MODEL = "claude-haiku-4-5";

export const EMBEDDING = { provider: "voyage", model: "voyage-3.5-lite", dimensions: 1024, url: "https://api.voyageai.com/v1/embeddings" } as const;

/** PLACEHOLDER caps, in US dollars, counted from ai_calls (UTC day and month). */
export const SPEND_CAPS_USD = { perDay: 5, perMonth: 50 } as const;

/** Per million tokens, in US dollars (Anthropic and Voyage list prices). Cache writes 1.25x input, reads 0.1x. */
export const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "voyage-3.5-lite": { input: 0.02, output: 0, cacheWrite: 0, cacheRead: 0 },
};

export function costUsd(model: string, u: { input?: number; output?: number; cacheWrite?: number; cacheRead?: number }): number {
  const p = PRICES[model];
  if (!p) return 0;
  const usd = ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output + (u.cacheWrite ?? 0) * p.cacheWrite + (u.cacheRead ?? 0) * p.cacheRead) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
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
