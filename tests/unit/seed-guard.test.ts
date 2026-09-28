import { describe, expect, it } from "vitest";
import { refuseSeed } from "../../scripts/seed-guard.mjs";

const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("refuseSeed", () => {
  it("allows a local database", () => {
    expect(refuseSeed({ SEED_DATABASE_URL: local })).toBeNull();
    expect(refuseSeed({ SEED_DATABASE_URL: "postgresql://postgres@localhost/dev" })).toBeNull();
  });

  it.each([
    [{}, /Set SEED_DATABASE_URL/],
    [{ SEED_DATABASE_URL: local, NODE_ENV: "production" }, /production/],
    [{ SEED_DATABASE_URL: local, VERCEL: "1" }, /Vercel/],
    [{ SEED_DATABASE_URL: local, VERCEL_ENV: "preview" }, /Vercel/],
    [{ SEED_DATABASE_URL: "postgresql://postgres:x@db.abcd.supabase.co:5432/postgres" }, /hosted Supabase/],
    [{ SEED_DATABASE_URL: "postgresql://postgres.abcd:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres" }, /hosted Supabase/],
    [{ SEED_DATABASE_URL: "postgresql://postgres:x@10.0.0.5:5432/postgres" }, /not a local host/],
    [{ SEED_DATABASE_URL: "not a url" }, /not a valid/],
  ])("refuses %o", (env, reason) => {
    expect(refuseSeed(env as Record<string, string>)).toMatch(reason);
  });
});
