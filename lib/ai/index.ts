import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getDb } from "@/lib/db";
import { AI_MODELS, EMBEDDING, HEALTH_MODEL, costUsd, spendCaps, type AiPurpose } from "./config";

/**
 * L1: the AI orchestration service. Every model call and every embedding goes through here:
 *   - off when ANTHROPIC_API_KEY is missing (AI features say so; the rest of the site works);
 *   - refused once the day's or the month's spend reaches its cap (lib/ai/config.ts);
 *   - logged in ai_calls: purpose, model, tokens, cost, outcome. Never the prompt, the answer or learner content;
 *   - a successful call or health check marks the provider Connected (connection_statuses), with evidence.
 * Prompt caching: the stable system prompt is cached automatically (top-level cache_control). Short prompts below
 * the model's minimum cacheable size are simply not cached; nothing breaks.
 */

export class AiUnavailable extends Error {
  constructor(readonly code: "ai_off" | "cap_reached" | "embeddings_off" | "failed", message: string) {
    super(message);
    this.name = "AiUnavailable";
  }
}

export const AI_OFF = "AI features are off: ANTHROPIC_API_KEY isn't set. Everything else keeps working.";

const key = (name: "ANTHROPIC_API_KEY" | "VOYAGE_API_KEY") => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};
export const aiConfigured = () => !!key("ANTHROPIC_API_KEY");
export const embeddingsConfigured = () => !!key("VOYAGE_API_KEY");

type CallLog = {
  purpose: string; provider: "anthropic" | "voyage"; model: string; status: "ok" | "error" | "refused_cap" | "refused_off";
  input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number;
  cost_usd?: number; duration_ms?: number; error_code?: string | null; account_id?: string | null; request_id?: string | null;
};
async function logCall(row: CallLog) {
  const { error } = await getDb().from("ai_calls").insert(row);
  if (error) console.error("[ai] call log failed:", error.message);
}

/** Spend so far today and this month (UTC), from the call log. */
export async function spendSoFar(now = new Date()): Promise<{ day: number; month: number }> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { data, error } = await getDb().from("ai_calls").select("cost_usd, created_at").gte("created_at", monthStart);
  if (error) throw new Error(`spend lookup failed: ${error.message}`);
  let day = 0;
  let month = 0;
  for (const r of (data ?? []) as { cost_usd: number | string; created_at: string }[]) {
    const c = Number(r.cost_usd) || 0;
    month += c;
    if (r.created_at >= dayStart) day += c;
  }
  return { day, month };
}

type Who = { accountId?: string | null; requestId?: string | null };

async function gate(purpose: string, provider: "anthropic" | "voyage", model: string, who: Who) {
  const caps = spendCaps();
  const spent = await spendSoFar();
  if (spent.day >= caps.perDay || spent.month >= caps.perMonth) {
    await logCall({ purpose, provider, model, status: "refused_cap", account_id: who.accountId, request_id: who.requestId });
    throw new AiUnavailable("cap_reached", `The AI spend cap is reached (today $${spent.day.toFixed(2)} of $${caps.perDay}, this month $${spent.month.toFixed(2)} of $${caps.perMonth}). Try again later.`);
  }
}

/** Records Connected (with evidence) or Disconnected (with a reason) for a provider. */
export async function setConnection(service: "anthropic" | "voyage", ok: boolean, detail: string) {
  const db = getDb();
  const row = ok
    ? { status: "connected", evidence: detail, reason: null, checked_at: new Date().toISOString() }
    : { status: "disconnected", evidence: null, reason: detail, checked_at: new Date().toISOString() };
  const { data, error } = await db.from("connection_statuses").update(row).eq("service", service).select("id");
  if (error) throw new Error(`connection status update failed: ${error.message}`);
  if (!data?.length) {
    const ins = await db.from("connection_statuses").insert({ service, ...row });
    if (ins.error && ins.error.code !== "23505") throw new Error(`connection status insert failed: ${ins.error.message}`);
  }
}

function client() {
  const apiKey = key("ANTHROPIC_API_KEY");
  if (!apiKey) throw new AiUnavailable("ai_off", AI_OFF);
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
}

/** One structured-output call: the answer is validated against `schema` (Zod). */
export async function structured<S extends z.ZodType>(
  purpose: AiPurpose,
  args: { system: string; user: string; schema: S; maxTokens?: number } & Who,
): Promise<z.infer<S>> {
  const model = AI_MODELS[purpose];
  if (!aiConfigured()) {
    await logCall({ purpose, provider: "anthropic", model, status: "refused_off", account_id: args.accountId, request_id: args.requestId });
    throw new AiUnavailable("ai_off", AI_OFF);
  }
  await gate(purpose, "anthropic", model, args);
  const started = Date.now();
  try {
    const res = await client().messages.parse({
      model,
      max_tokens: args.maxTokens ?? 4096,
      cache_control: { type: "ephemeral" },
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      output_config: { format: zodOutputFormat(args.schema) },
    });
    const u = res.usage;
    const usage = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    const refused = res.stop_reason === "refusal" || res.parsed_output == null;
    await logCall({
      purpose, provider: "anthropic", model, status: refused ? "error" : "ok", input_tokens: usage.input, output_tokens: usage.output,
      cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, cost_usd: costUsd(model, usage),
      duration_ms: Date.now() - started, error_code: refused ? (res.stop_reason === "refusal" ? "refusal" : "unparsed") : null,
      account_id: args.accountId, request_id: args.requestId,
    });
    await setConnection("anthropic", true, `A ${model} call succeeded at ${new Date().toISOString()}`);
    if (refused) throw new AiUnavailable("failed", "The model didn't return a usable answer. Nothing was saved.");
    return res.parsed_output as z.infer<S>;
  } catch (err) {
    if (err instanceof AiUnavailable) throw err;
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    await logCall({
      purpose, provider: "anthropic", model, status: "error", duration_ms: Date.now() - started,
      error_code: status ? `http_${status}` : err instanceof Error ? err.name : "unknown", account_id: args.accountId, request_id: args.requestId,
    });
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      await setConnection("anthropic", false, `The API key was refused (${status}).`);
    }
    throw new AiUnavailable("failed", `The AI call failed${status ? ` (${status})` : ""}. Nothing was saved.`);
  }
}

/**
 * Embeddings (Voyage AI). Returns null when VOYAGE_API_KEY isn't set: search then uses full-text ranking only.
 * Throws AiUnavailable when the spend cap is reached or the call fails.
 */
export async function embed(texts: string[], inputType: "document" | "query", who: Who = {}): Promise<number[][] | null> {
  const apiKey = key("VOYAGE_API_KEY");
  if (!apiKey || !texts.length) return null;
  const purpose = `embed.${inputType}`;
  await gate(purpose, "voyage", EMBEDDING.model, who);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(EMBEDDING.url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ input: batch, model: EMBEDDING.model, input_type: inputType, output_dimension: EMBEDDING.dimensions }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      await logCall({ purpose, provider: "voyage", model: EMBEDDING.model, status: "error", duration_ms: Date.now() - started, error_code: err instanceof Error ? err.name : "network", account_id: who.accountId, request_id: who.requestId });
      throw new AiUnavailable("failed", "The embedding service didn't answer. Nothing was saved.");
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };
    const tokens = body.usage?.total_tokens ?? 0;
    const ok = res.ok && Array.isArray(body.data) && body.data.length === batch.length;
    await logCall({
      purpose, provider: "voyage", model: EMBEDDING.model, status: ok ? "ok" : "error", input_tokens: tokens,
      cost_usd: costUsd(EMBEDDING.model, { input: tokens }), duration_ms: Date.now() - started,
      error_code: ok ? null : `http_${res.status}`, account_id: who.accountId, request_id: who.requestId,
    });
    if (!ok) {
      if (res.status === 401 || res.status === 403) await setConnection("voyage", false, `The API key was refused (${res.status}).`);
      throw new AiUnavailable("failed", `The embedding service failed (${res.status}). Nothing was saved.`);
    }
    await setConnection("voyage", true, `An ${EMBEDDING.model} embedding call succeeded at ${new Date().toISOString()}`);
    for (const d of [...body.data!].sort((a, b) => a.index - b.index)) out.push(d.embedding);
  }
  return out;
}

/**
 * The model provider's health check: GET /v1/models/{id} (no tokens, no cost). Connected only when it succeeds.
 */
export async function checkAnthropic(who: Who = {}): Promise<{ status: "connected" | "disconnected"; detail: string }> {
  if (!aiConfigured()) {
    await setConnection("anthropic", false, "ANTHROPIC_API_KEY isn't set: AI features are off.");
    return { status: "disconnected", detail: "ANTHROPIC_API_KEY isn't set: AI features are off." };
  }
  const started = Date.now();
  try {
    const m = await client().models.retrieve(HEALTH_MODEL, undefined, { timeout: 10_000, maxRetries: 1 });
    const detail = `GET /v1/models/${m.id} succeeded at ${new Date().toISOString()}`;
    await logCall({ purpose: "health", provider: "anthropic", model: HEALTH_MODEL, status: "ok", duration_ms: Date.now() - started, account_id: who.accountId, request_id: who.requestId });
    await setConnection("anthropic", true, detail);
    return { status: "connected", detail };
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    const detail = `The health check failed${status ? ` (${status})` : `: ${err instanceof Error ? err.message : "no response"}`}.`;
    await logCall({ purpose: "health", provider: "anthropic", model: HEALTH_MODEL, status: "error", duration_ms: Date.now() - started, error_code: status ? `http_${status}` : "network", account_id: who.accountId, request_id: who.requestId });
    await setConnection("anthropic", false, detail);
    return { status: "disconnected", detail };
  }
}

/** For the status page: the stored state and today's / this month's spend against the caps. */
export async function aiStatus() {
  const db = getDb();
  const { data } = await db.from("connection_statuses").select("service, status, evidence, reason, checked_at").in("service", ["anthropic", "voyage"]);
  const rows = (data ?? []) as { service: string; status: string; evidence: string | null; reason: string | null; checked_at: string | null }[];
  return {
    configured: aiConfigured(), embeddings: embeddingsConfigured(), models: AI_MODELS, caps: spendCaps(), spent: await spendSoFar(),
    connections: Object.fromEntries(rows.map((r) => [r.service, r])),
  };
}
