import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { HEALTH_MODEL } from "@/lib/ai/config";
import { createServiceClient } from "@/lib/db";
import { connected, disconnected, type ConnectionStatus, type ServiceName } from "@/lib/connection-status";
import { readEnv } from "@/lib/env";

const TIMEOUT_MS = 5000;
const CLERK_API = "https://api.clerk.com/v1";

type ProbeOptions = { fetch?: typeof fetch; timeoutMs?: number };

function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(ms) });
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? `No response within ${TIMEOUT_MS / 1000}s` : err.message;
  return "Unknown error";
}

/** Connected only if an admin call succeeds with the service key. */
export async function probeSupabase(
  config: { url?: string; serviceRoleKey?: string },
  opts: ProbeOptions = {},
): Promise<ConnectionStatus> {
  if (!config.url || !config.serviceRoleKey) return disconnected("supabase", "Not configured");
  try {
    const db = createServiceClient({
      url: config.url,
      serviceRoleKey: config.serviceRoleKey,
      fetch: withTimeout(opts.fetch ?? fetch, opts.timeoutMs ?? TIMEOUT_MS),
    });
    const { error } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) return disconnected("supabase", `Auth admin call failed (${error.status ?? "no status"}): ${error.message}`);
    return connected("supabase", "Auth admin call with the service key returned successfully");
  } catch (err) {
    return disconnected("supabase", describe(err));
  }
}

/** Connected only if the Backend API accepts the secret key. */
export async function probeClerk(config: { secretKey?: string }, opts: ProbeOptions = {}): Promise<ConnectionStatus> {
  if (!config.secretKey) return disconnected("clerk", "Not configured");
  try {
    const res = await withTimeout(opts.fetch ?? fetch, opts.timeoutMs ?? TIMEOUT_MS)(`${CLERK_API}/jwks`, {
      headers: { Authorization: `Bearer ${config.secretKey}` },
      cache: "no-store",
    });
    if (!res.ok) return disconnected("clerk", `Backend API returned ${res.status}`);
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { keys?: unknown }).keys)) {
      return disconnected("clerk", "Backend API response was not a JWKS");
    }
    return connected("clerk", `GET /v1/jwks with the secret key returned ${res.status}`);
  } catch (err) {
    return disconnected("clerk", describe(err));
  }
}

/**
 * L1: Connected only if the model provider answers GET /v1/models/{id} with the key (no tokens, no cost). Without a
 * key, AI features are off and the status says so; the rest of the site is unaffected.
 */
export async function probeAnthropic(config: { apiKey?: string }, opts: ProbeOptions = {}): Promise<ConnectionStatus> {
  if (!config.apiKey) return disconnected("anthropic", "Not configured: AI features are off");
  try {
    const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? TIMEOUT_MS, fetch: opts.fetch });
    const m = await client.models.retrieve(HEALTH_MODEL);
    return connected("anthropic", `GET /v1/models/${m.id} with the API key succeeded`);
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status) return disconnected("anthropic", `Models API returned ${err.status}`);
    return disconnected("anthropic", describe(err));
  }
}

/** The AI provider is probed at most every 10 minutes per server instance (the others every HEALTH_CACHE_SECONDS). */
const AI_PROBE_SECONDS = 600;
let aiCache: { expiresAt: number; status: Promise<ConnectionStatus> } | undefined;
function anthropicStatus(now = Date.now()) {
  if (!aiCache || aiCache.expiresAt <= now) {
    aiCache = { expiresAt: now + AI_PROBE_SECONDS * 1000, status: probeAnthropic({ apiKey: readAiKey() }) };
  }
  return aiCache.status;
}
const readAiKey = () => process.env["ANTHROPIC_API_KEY"]?.trim() || undefined;

export const HEALTH_CACHE_SECONDS = 30;

type Services = Record<ServiceName, ConnectionStatus>;
let cache: { expiresAt: number; services: Promise<Services> } | undefined;

async function checkServices(): Promise<Services> {
  const [supabase, clerk, anthropic] = await Promise.all([
    probeSupabase({ url: readEnv("SUPABASE_URL"), serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY") }),
    probeClerk({ secretKey: readEnv("CLERK_SECRET_KEY") }),
    anthropicStatus(),
  ]);
  return { supabase, clerk, anthropic };
}

/**
 * Service statuses, checked at most once per HEALTH_CACHE_SECONDS per server instance.
 * Concurrent callers share one in-flight check. Each status keeps its own checkedAt,
 * so a cached answer never looks fresher than it is.
 */
export async function getServiceStatuses(now = Date.now()): Promise<{ services: Services; cached: boolean }> {
  if (cache && cache.expiresAt > now) return { services: await cache.services, cached: true };
  const services = checkServices();
  cache = { expiresAt: now + HEALTH_CACHE_SECONDS * 1000, services };
  return { services: await services, cached: false };
}

export function resetHealthCacheForTests() {
  cache = undefined;
  aiCache = undefined;
}
