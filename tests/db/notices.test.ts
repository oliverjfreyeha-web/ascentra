import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** B4 (0011): notices and privacy requests, applied as the SQL Editor bundle to a live B3 database. */
describe("the B4 bundle on the live B3 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string;
  let learner: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0011")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    owner = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
             values ('user_live_owner', 'owner@example.com', true, 'owner', now(), true) returning id`)).rows[0].id;
    learner = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
             values ('user_learner', 'learner@example.com', true, 'learner', now()) returning id`)).rows[0].id;
    await q(readSql("db/apply/B4.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql is OK", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^OK: all 47 tables.*B4 notices and privacy requests are in place$/);
  });

  it("sends each notice once (dedupe key), and a sent notice has a time", async () => {
    const add = (key: string, status = "queued", sent: string | null = null) =>
      q(`insert into public.notices (account_id, kind, dedupe_key, status, sent_at) values ($1, 'payment_failed', $2, $3, $4)`, [learner, key, status, sent]);
    await add("payment_failed:in_1");
    await expect(add("payment_failed:in_1")).rejects.toThrow(/notices_dedupe_key_key/);
    await expect(add("payment_failed:in_2", "sent")).rejects.toThrow(/notices_check/);
    await expect(add("payment_failed:in_3", "sent", new Date().toISOString())).resolves.toBeDefined();
  });

  it("tracks privacy requests with a due date; one open deletion per account; never for the Owner", async () => {
    const req = (who: string, kind = "deletion") => q(
      `insert into public.privacy_requests (account_id, requested_by_account_id, kind, due_at) values ($1, $1, $2, now() + interval '45 days')`, [who, kind]);
    await req(learner);
    await expect(req(learner)).rejects.toThrow(/privacy_requests_one_open_deletion/);
    await expect(req(learner, "export")).resolves.toBeDefined();
    await expect(req(owner)).rejects.toThrow(/Owner account can't be deleted/);
    await expect(q(`insert into public.privacy_requests (account_id, requested_by_account_id, kind, due_at, status) values ($1, $1, 'export', now(), 'completed')`, [learner]))
      .rejects.toThrow(/privacy_requests_check/);
  });

  it("keeps both tables away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.notices', 'select') as n,
      has_table_privilege('anon', 'public.privacy_requests', 'select') as p`);
    expect(rows[0]).toEqual({ n: false, p: false });
  });

  it("refuses B4 on a database without B3", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0010")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/B4.sql"))).rejects.toThrow(/apply B3 \(0010\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
