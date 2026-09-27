import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

export type ServiceClientConfig = { url: string; serviceRoleKey: string; fetch?: typeof fetch };

/**
 * Supabase client with the service role key. Server-only: importing this from a
 * Client Component fails the build. Only app/api/** may use it (enforced by lint).
 */
export function createServiceClient({ url, serviceRoleKey, fetch: fetchImpl }: ServiceClientConfig): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: fetchImpl ? { fetch: fetchImpl } : undefined,
  });
}

let client: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  if (!client) {
    const env = getServerEnv();
    client = createServiceClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  }
  return client;
}
