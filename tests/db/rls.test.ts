import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPECTED_TABLES, asRole, clerkClaims, createTestDb, type TestDb } from "./helpers";

let db: TestDb;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  for (const [key, name] of [["ann", "Ann Learner"], ["ben", "Ben Learner"]]) {
    const { rows } = await db.client.query(
      `insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
       values ($1, $2, true, 'learner', now()) returning id`,
      [`user_${key}`, `${key}@example.com`],
    );
    ids[key] = rows[0].id;
    await db.client.query("insert into public.profiles (account_id, display_name) values ($1, $2)", [ids[key], name]);
  }
});
afterAll(() => db.drop());

describe("row-level security is on for every table", () => {
  it("lists every table in public, and each one has RLS enabled", async () => {
    const { rows } = await db.client.query(`
      select c.relname as table_name, c.relrowsecurity as rls
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      order by c.relname`);
    // A new table must be added here on purpose, and must have RLS, or this fails.
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
    expect(rows.filter((r) => !r.rls).map((r) => r.table_name)).toEqual([]);
  });

  it("grants anon nothing, and authenticated only SELECT on accounts (safe columns) and profiles", async () => {
    const { rows } = await db.client.query(`
      select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
    expect(rows).toEqual([{ grantee: "authenticated", table_name: "profiles", privilege_type: "SELECT" }]);
    const cols = await db.client.query(`
      select column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'accounts' and grantee = 'authenticated' order by column_name`);
    expect(cols.rows.map((r) => r.column_name)).toEqual(
      ["created_at", "email", "email_verified", "id", "is_minor", "role", "status", "updated_at"],
    );
  });

  it("has policies only on the identity tables and the insert-only tables", async () => {
    const { rows } = await db.client.query(
      "select distinct tablename from pg_policies where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual(["accounts", "audit_events", "consent_records", "profiles"]);
  });
});

describe("a learner calling Supabase directly (bypassing the API)", () => {
  const ann = clerkClaims("user_ann");

  it("reads their own profile", async () => {
    const r = await asRole(db.client, "authenticated", ann, "select display_name from public.profiles");
    expect(r.rows).toEqual([{ display_name: "Ann Learner" }]);
  });

  it("cannot read another learner's profile, even asking for it by id", async () => {
    const r = await asRole(db.client, "authenticated", ann, "select * from public.profiles where account_id = $1", [ids.ben]);
    expect(r.rows).toEqual([]);
  });

  it("cannot read another learner's account", async () => {
    const r = await asRole(db.client, "authenticated", ann, "select id, email from public.accounts");
    expect(r.rows).toEqual([{ id: ids.ann, email: "ann@example.com" }]);
  });

  it("cannot read account columns outside the safe list (e.g. clerk_user_id), even their own", async () => {
    const r = await asRole(db.client, "authenticated", ann, "select clerk_user_id from public.accounts");
    expect(r.error).toMatch(/permission denied/);
  });

  it("cannot change a profile, their own included", async () => {
    const r = await asRole(db.client, "authenticated", ann, "update public.profiles set display_name = 'x'");
    expect(r.error).toMatch(/permission denied/);
  });

  it("cannot read any other table", async () => {
    for (const t of EXPECTED_TABLES.filter((t) => t !== "accounts" && t !== "profiles")) {
      const r = await asRole(db.client, "authenticated", ann, `select 1 from public.${t} limit 1`);
      expect(r.error, t).toMatch(/permission denied/);
    }
  });

  it("with a token for someone who has no Account, sees nothing", async () => {
    const r = await asRole(db.client, "authenticated", clerkClaims("user_stranger"), "select * from public.profiles");
    expect(r.rows).toEqual([]);
  });

  it("with a disabled Account, sees nothing", async () => {
    await db.client.query("update public.accounts set status = 'disabled' where id = $1", [ids.ben]);
    const r = await asRole(db.client, "authenticated", clerkClaims("user_ben"), "select * from public.profiles");
    expect(r.rows).toEqual([]);
    await db.client.query("update public.accounts set status = 'active' where id = $1", [ids.ben]);
  });

  it("without signing in (anon), is refused everywhere", async () => {
    for (const t of EXPECTED_TABLES) {
      const r = await asRole(db.client, "anon", null, `select 1 from public.${t} limit 1`);
      expect(r.error, t).toMatch(/permission denied/);
    }
  });
});
