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

  it("creates exactly the 52 tables (39 entities + 4 F6 + 2 B1 + 2 B4 + 3 L1 + 2 L2 tables)", async () => {
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
    expect(rows).toHaveLength(52);
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
    expect(rows[0].table_name).toMatch(/^OK: all 52 tables.*B3 Guardians are in place; B4 notices and privacy requests are in place; L1 source library is in place; L2 course generation and review are in place$/);
    expect(rows.filter((r) => r.sort === 1 && r.table_exists && r.rls_on)).toHaveLength(52);
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
    await db.client.query(readSql("db/apply/F5.sql"));
    await db.client.query(readSql("db/apply/F6.sql"));
    await db.client.query(readSql("db/apply/B1.sql"));
    await db.client.query(readSql("db/apply/B2.sql"));
    await db.client.query(readSql("db/apply/B3.sql"));
    await db.client.query(readSql("db/apply/B4.sql"));
    await db.client.query(readSql("db/apply/L1.sql"));
    await db.client.query(readSql("db/apply/L2.sql"));
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
    await expect(db.client.query(readSql("db/apply/F5.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/F6.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/B1.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/B2.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/B3.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/B4.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/L1.sql"))).rejects.toThrow(/already applied/);
    await db.client.query("rollback");
    await expect(db.client.query(readSql("db/apply/L2.sql"))).rejects.toThrow(/already applied/);
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

describe("the F5 bundle on a database at F4 that already has audit rows", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0006")) await db.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
    await db.client.query(`insert into public.audit_events (actor_label, action, occurred_at)
                           values ('System', 'older', now() - interval '2 days'), ('System', 'newer', now() - interval '1 day')`);
  });
  afterAll(() => db.drop());

  it("chains the existing rows in time order, keeps them unchanged otherwise, and verifies", async () => {
    await db.client.query(readSql("db/apply/F5.sql"));
    const { rows } = await db.client.query("select seq, action from public.audit_events order by seq");
    expect(rows).toEqual([{ seq: "1", action: "older" }, { seq: "2", action: "newer" }]);
    expect((await db.client.query("select ok, checked from public.audit_verify_chain()")).rows[0]).toEqual({ ok: true, checked: "2" });
    // Until F6 is applied, the verdict names what's missing.
    expect((await db.client.query(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 13 missing.*F5 applied, F6 NOT applied, B1 NOT applied, B2 NOT applied, B3 NOT applied, B4 NOT applied, L1 NOT applied, L2 NOT applied$/);
  });

  it("leaves the insert-only trigger on", async () => {
    await expect(db.client.query("update public.audit_events set action = 'x'")).rejects.toThrow(/insert-only/);
  });

  it("refuses F5 on a database without F4", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0005")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/F5.sql"))).rejects.toThrow(/apply F4 \(0005\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});

describe("the F6 bundle on the live F5 database (Owner, audit rows)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0007")) await db.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
    await db.client.query(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
                           values ('user_live_owner', 'owner@example.com', true, 'owner', now(), true)`);
    await db.client.query(`insert into public.audit_events (actor_label, action) values ('System', 'f5 event'), ('Owner (Owner)', 'admins.invite')`);
  });
  afterAll(() => db.drop());

  it("applies in one go; the audit chain, the Owner and verify.sql are all fine afterwards", async () => {
    await db.client.query(readSql("db/apply/F6.sql"));
    expect((await db.client.query("select ok, checked from public.audit_verify_chain()")).rows[0]).toEqual({ ok: true, checked: "2" });
    expect((await db.client.query("select count(*)::int as n from public.accounts where role = 'owner'")).rows[0].n).toBe(1);
    expect((await db.client.query("select count(*)::int as n from public.trusted_devices")).rows[0].n).toBe(0);
    expect((await db.client.query(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 9 missing.*F6 applied, B1 NOT applied, B2 NOT applied, B3 NOT applied, B4 NOT applied, L1 NOT applied, L2 NOT applied$/);
  });

  it("keeps working with what the F5 code writes (an audit row with no device)", async () => {
    await db.client.query(`insert into public.audit_events (actor_label, action, device_id) values ('System', 'after f6', null)`);
    expect((await db.client.query("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });

  it("refuses F6 on a database without F5", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0006")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/F6.sql"))).rejects.toThrow(/apply F5 \(0006\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});

describe("the B1 bundle on the live F6 database (Owner, audit rows)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0008")) await db.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
    await db.client.query(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
                           values ('user_live_owner', 'owner@example.com', true, 'owner', now(), true)`);
    await db.client.query(`insert into public.audit_events (actor_label, action) values ('System', 'f6 event')`);
  });
  afterAll(() => db.drop());

  it("applies in one go; the audit chain, the Owner and verify.sql are all fine afterwards", async () => {
    await db.client.query(readSql("db/apply/B1.sql"));
    expect((await db.client.query("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
    expect((await db.client.query("select count(*)::int as n from public.accounts where role = 'owner'")).rows[0].n).toBe(1);
    expect((await db.client.query(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 7 missing.*B1 applied, B2 NOT applied, B3 NOT applied, B4 NOT applied, L1 NOT applied, L2 NOT applied$/);
  });

  it("publishes the Automatic Renewal Terms word for word as the checkout shows them", async () => {
    const { RENEWAL_TERMS_BODY, RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } = await import("../../lib/billing-terms");
    const { rows } = await db.client.query("select body, status from public.legal_document_versions where document_key = $1 and version = $2",
      [RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION]);
    expect(rows).toEqual([{ body: RENEWAL_TERMS_BODY, status: "published" }]);
  });

  it("allows only Stripe's lifecycle statuses on subscriptions", async () => {
    const owner = (await db.client.query("select id from public.accounts where role = 'owner'")).rows[0].id;
    const insert = (status: string) => db.client.query(
      `insert into public.subscriptions (payer_account_id, beneficiary_account_id, plan, status, started_at) values ($1, $1, 'basic', $2, now())`, [owner, status]);
    for (const s of ["trialing", "active", "past_due", "canceled", "ended"]) await expect(insert(s)).resolves.toBeDefined();
    await expect(insert("payment_failed")).rejects.toThrow(/subscriptions_status_check/);
  });

  it("refuses B1 on a database without F6", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0007")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/B1.sql"))).rejects.toThrow(/apply F6 \(0007\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
