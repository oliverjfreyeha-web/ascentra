import "server-only";
import { z } from "zod";
import secretEnv from "./secret-env-names.json";

/**
 * Every environment variable the server needs. There are no defaults:
 * a missing or malformed value stops the server at startup.
 */
export const serverEnvSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  OWNER_EMAIL: z.email(),
  // Vercel Cron sends it as "Authorization: Bearer ..." to /api/cron/*. 32+ random characters.
  CRON_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const REQUIRED_ENV_VARS = Object.keys(serverEnvSchema.shape) as (keyof ServerEnv)[];

/** Secrets never present at build time. Kept in a JSON file so scripts/build.mjs can read the same list. */
export const SECRET_ENV_VARS = secretEnv.names as readonly (keyof ServerEnv)[];

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(
      "ASCENTRA cannot start: environment is incomplete.\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\nSet these in .env.local (see .env.example) or the host's environment. No defaults are used.",
    );
    this.name = "EnvError";
  }
}

/** Validates a variable source. Messages name variables, never their values. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0]);
    return source[name] === undefined || source[name] === ""
      ? `${name} is missing`
      : `${name} is invalid (${issue.message})`;
  });
  throw new EnvError(problems);
}

/**
 * Reads and validates the environment at request time. Deliberately not cached and
 * never indexed with a literal name, so nothing about the values is fixed at build time.
 */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

/** One variable, read at request time. Undefined when unset; callers decide what that means. */
export function readEnv(name: keyof ServerEnv): string | undefined {
  const value = process.env[name];
  return value === "" ? undefined : value;
}
