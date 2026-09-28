import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPECTED_TABLES, MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

describe("migration files", () => {
  it("are numbered consecutively from 0001", () => {
    const numbers = migrationFiles().map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("have an up-to-date SQL Editor bundle (npm run db:bundle)", () => {
    expect(() => execFileSync("node", ["scripts/bundle-migrations.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });
});

describe("applying every migration, in order, to an empty database", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
  });
  afterAll(() => db.drop());

  it("applies cleanly, one file at a time", async () => {
    for (const f of migrationFiles()) {
      await expect(db.client.query(readSql(`${MIGRATIONS_DIR}/${f}`)), f).resolves.toBeDefined();
    }
  });

  it("records each migration in the ledger", async () => {
    const { rows } = await db.client.query("select version from private.schema_migrations order by version");
    expect(rows.map((r) => r.version)).toEqual(migrationFiles().map((f) => f.replace(/\.sql$/, "")));
  });

  it("creates exactly the 39 tables", async () => {
    const { rows } = await db.client.query(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual(EXPECTED_TABLES);
  });

  it("gives every table an id, created_at, updated_at and retention_class", async () => {
    const { rows } = await db.client.query(`
      select t.tablename, array_agg(c.column_name::text order by c.column_name) filter (
        where c.column_name in ('id', 'created_at', 'updated_at', 'retention_class')) as cols
      from pg_tables t join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = t.tablename
      where t.schemaname = 'public' group by t.tablename`);
    for (const r of rows) expect(r.cols, r.tablename).toEqual(["created_at", "id", "retention_class", "updated_at"]);
    expect(rows).toHaveLength(39);
  });

  it("refuses to apply a migration twice, and changes nothing when it does", async () => {
    for (const f of migrationFiles().slice(1)) {
      const before = await db.client.query("select count(*)::int as n from private.schema_migrations");
      await expect(db.client.query(`begin; ${readSql(`${MIGRATIONS_DIR}/${f}`)}; commit;`)).rejects.toThrow(/already applied/);
      await db.client.query("rollback");
      const after = await db.client.query("select count(*)::int as n from private.schema_migrations");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    }
  });

  it("passes the verification query in db/verify.sql", async () => {
    const { rows } = await db.client.query(readSql("db/verify.sql"));
    expect(rows[0].table_name).toMatch(/^OK: all 39 tables/);
    expect(rows.filter((r) => r.sort === 1 && r.table_exists && r.rls_on)).toHaveLength(39);
  });
});

describe("the F3 then F4 SQL Editor bundles on a database that has only 0001", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    await db.client.query(readSql(`${MIGRATIONS_DIR}/0001_accounts.sql`));
    // The live Owner row, as F2 created it.
    await db.client.query(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
                           values ('user_live_owner', 'owner@example.com', true, 'owner', now())`);
    await db.client.query(`insert into public.profiles (account_id, display_name)
                           select id, 'Owner' from public.accounts`);
  });
  afterAll(() => db.drop());

  it("applies in one go and keeps the existing Owner and profile", async () => {
    await db.client.query(readSql("db/apply/F3.sql"));
    await db.client.query(readSql("db/apply/F4.sql"));
    const { rows } = await db.client.query(
      "select a.role, a.is_minor, a.retention_class, p.id is not null as has_id from public.accounts a join public.profiles p on p.account_id = a.id",
    );
    expect(rows).toEqual([{ role: "owner", is_minor: false, retention_class: "account", has_id: true }]);
    const verify = await db.client.query(readSql("db/verify.sql"));
    expect(verify.rows[0].table_name).toMatch(/^OK/);
  });

  it("changes nothing when pasted a second time", async () => {
    const count = async () =>
      (await db.client.query("select count(*)::int as n from private.schema_migrations")).rows[0].n;
    const before = await count();
    await expect(db.client.query(readSql("db/apply/F3.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/F4.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    expect(await count()).toBe(before);
  });

  it("refuses F4 on a database without F3", async () => {
    const onlyOne = await createTestDb({ migrate: false });
    try {
      await onlyOne.client.query(readSql(`${MIGRATIONS_DIR}/0001_accounts.sql`));
      await expect(onlyOne.client.query(readSql("db/apply/F4.sql"))).rejects.toThrow(/apply F3 \(0002-0004\) first/);
    } finally {
      await onlyOne.client.query("rollback").catch(() => {});
      await onlyOne.drop();
    }
  });

  it("refuses to run on a database without 0001", async () => {
    const empty = await createTestDb({ migrate: false });
    try {
      await expect(empty.client.query(readSql("db/apply/F3.sql"))).rejects.toThrow(/apply 0001_accounts\.sql first/);
    } finally {
      await empty.client.query("rollback").catch(() => {});
      await empty.drop();
    }
  });
});
