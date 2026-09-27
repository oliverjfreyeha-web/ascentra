import { describe, expect, it } from "vitest";
import { EnvError, parseServerEnv, REQUIRED_ENV_VARS } from "@/lib/env";
import { TEST_ENV } from "../fixtures/env";

const valid = { ...TEST_ENV };

describe("server env", () => {
  it("lists every required variable", () => {
    expect([...REQUIRED_ENV_VARS].sort()).toEqual([
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "OWNER_EMAIL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
    ]);
  });

  it("accepts a complete environment", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
  });

  it("fails naming every missing variable, with no defaults", () => {
    let err: unknown;
    try {
      parseServerEnv({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvError);
    const msg = (err as Error).message;
    for (const name of REQUIRED_ENV_VARS) expect(msg).toContain(`${name} is missing`);
  });

  it.each(REQUIRED_ENV_VARS)("fails when only %s is missing", (name) => {
    expect(() => parseServerEnv({ ...valid, [name]: undefined })).toThrow(`${name} is missing`);
  });

  it("treats empty strings as missing", () => {
    expect(() => parseServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow("SUPABASE_SERVICE_ROLE_KEY is missing");
  });

  it("never echoes secret values in the error", () => {
    const bad = { ...valid, CLERK_SECRET_KEY: "not-a-clerk-key-SECRET123" };
    expect(() => parseServerEnv(bad)).toThrow(/CLERK_SECRET_KEY is invalid/);
    try {
      parseServerEnv(bad);
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET123");
    }
  });
});
