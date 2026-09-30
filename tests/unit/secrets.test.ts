import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_ENV_VARS, SECRET_ENV_VARS } from "@/lib/env";
import { BILLING_ENV_VARS } from "@/lib/billing-env";
import { buildEnv } from "../../scripts/build-env.mjs";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("server secrets", () => {
  it("are all required variables (or billing variables, which switch only billing off), and none is NEXT_PUBLIC_", () => {
    for (const name of SECRET_ENV_VARS) {
      expect([...REQUIRED_ENV_VARS, ...BILLING_ENV_VARS]).toContain(name);
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("are never read as a literal process.env.NAME in app or lib code (only lib/env reads them, at request time)", () => {
    const offenders = ["app", "lib", "proxy.ts", "instrumentation.ts"]
      .flatMap((p) => (statSync(p).isDirectory() ? sourceFiles(p) : [p]))
      .filter((f) => SECRET_ENV_VARS.some((name) => readFileSync(f, "utf8").includes(`process.env.${name}`)));
    expect(offenders).toEqual([]);
  });

  it("are removed from the build environment, with anything else that looks like a credential", () => {
    const { env, removed } = buildEnv({
      PATH: "/usr/bin",
      NODE_ENV: "production",
      SUPABASE_URL: "https://x.supabase.co",
      OWNER_EMAIL: "owner@example.com",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
      __NEXT_PRIVATE_FLAG: "1",
      SUPABASE_SERVICE_ROLE_KEY: "s1",
      CLERK_SECRET_KEY: "s2",
      CLERK_WEBHOOK_SIGNING_SECRET: "s3",
      STRIPE_API_KEY: "s4",
      SOME_TOKEN: "s5",
      DATABASE_URL: "s6",
    });
    expect(removed).toEqual([
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "DATABASE_URL",
      "SOME_TOKEN",
      "STRIPE_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(Object.keys(env).sort()).toEqual([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "NODE_ENV",
      "OWNER_EMAIL",
      "PATH",
      "SUPABASE_URL",
      "__NEXT_PRIVATE_FLAG",
    ]);
  });
});
