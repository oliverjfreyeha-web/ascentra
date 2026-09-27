import "server-only";
import { z } from "zod";

/**
 * Every environment variable the server needs. There are no defaults:
 * a missing or malformed value stops the server at startup.
 */
export const serverEnvSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const REQUIRED_ENV_VARS = Object.keys(serverEnvSchema.shape) as (keyof ServerEnv)[];

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

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
