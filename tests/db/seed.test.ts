import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
const seed = (env: Partial<NodeJS.ProcessEnv>) => {
  try {
    const out = execFileSync("node", ["scripts/seed-dev.mjs"], {
      env: { NODE_ENV: "test", PATH: process.env.PATH, ...env },
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { code: err.status, out: err.stderr };
  }
};

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

describe("scripts/seed-dev.mjs", () => {
  it("seeds a local database, and can run again without duplicating anything", async () => {
    expect(seed({ SEED_DATABASE_URL: db.url }).code).toBe(0);
    const count = async () =>
      (await db.client.query(`select (select count(*) from public.accounts)::int as accounts,
                                     (select count(*) from public.courses)::int as courses,
                                     (select count(*) from public.consent_records)::int as consents`)).rows[0];
    const first = await count();
    expect(first).toEqual({ accounts: 5, courses: 2, consents: 2 });
    expect(seed({ SEED_DATABASE_URL: db.url }).code).toBe(0);
    expect(await count()).toEqual(first);
    const teen = await db.client.query("select is_minor from public.accounts where clerk_user_id = 'user_seed_eli'");
    expect(teen.rows[0].is_minor).toBe(true);
  });

  it("refuses when the database has a real account", async () => {
    await db.client.query(`insert into public.accounts (clerk_user_id, email, role, clerk_updated_at)
                           values ('user_real', 'real@example.com', 'learner', now())`);
    const r = seed({ SEED_DATABASE_URL: db.url });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/real account/);
  });

  it("refuses production settings before connecting", () => {
    expect(seed({ SEED_DATABASE_URL: db.url, NODE_ENV: "production" }).out).toMatch(/NODE_ENV is production/);
    expect(seed({ SEED_DATABASE_URL: db.url, VERCEL_ENV: "production" }).out).toMatch(/Vercel/);
    expect(seed({ SEED_DATABASE_URL: "postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres" }).out)
      .toMatch(/hosted Supabase/);
  });
});
