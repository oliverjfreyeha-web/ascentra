// The seed script only ever runs against a local database. These checks happen before it connects.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Returns a reason to refuse, or null when the target is clearly local development. */
export function refuseSeed(env) {
  const url = env.SEED_DATABASE_URL;
  if (!url) return "Set SEED_DATABASE_URL to a local Postgres connection string.";
  if (env.NODE_ENV === "production") return "NODE_ENV is production.";
  if (env.VERCEL || env.VERCEL_ENV) return "This looks like a Vercel environment.";
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return "SEED_DATABASE_URL is not a valid connection URL.";
  }
  if (/supabase\.(co|com)$|pooler\./i.test(host)) return `${host} is a hosted Supabase database.`;
  if (!LOCAL_HOSTS.has(host)) return `${host} is not a local host (allowed: ${[...LOCAL_HOSTS].join(", ")}).`;
  return null;
}

/** Seeded accounts use this Clerk id prefix; any other account means this is not a dev database. */
export const SEED_USER_PREFIX = "user_seed_";
