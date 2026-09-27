import "server-only";
import { createServiceClient } from "@/lib/db";
import { connected, disconnected, type ConnectionStatus } from "@/lib/connection-status";

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
