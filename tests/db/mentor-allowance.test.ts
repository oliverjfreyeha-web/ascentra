import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";
import { MENTOR_ALLOWANCE_TERMS_BODY } from "@/lib/mentor-allowance-terms";

/** L5 (0016): the Mentor allowance add-on, applied as the bundle to a live L4 database with a subscription on it. */
describe("the L5 bundle on the live L4 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let learner: string;
  let sub: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0016")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    learner = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
      values ('user_learner', 'learner@example.com', true, 'learner', now()) returning id`)).rows[0].id;
    sub = (await q(`insert into public.subscriptions (payer_account_id, beneficiary_account_id, plan, status, started_at, processor_subscription_id)
      values ($1, $1, 'basic', 'active', now(), 'sub_1') returning id`, [learner])).rows[0].id;
    await q(readSql("db/apply/L5.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql says L5 is applied (L6 not yet); the live subscription has no add-on", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 24 missing.*L5 applied, L6 NOT applied, L7 NOT applied, L8 NOT applied, C1 NOT applied, C2 NOT applied$/);
    expect((await q("select mentor_addon_cents from public.subscriptions where id = $1", [sub])).rows[0].mentor_addon_cents).toBe(0);
  });

  it("publishes the Mentor Allowance Terms word for word as the code shows them", async () => {
    const { rows } = await q("select body, status from public.legal_document_versions where document_key = 'mentor_allowance_terms' and version = 'v0.1'");
    expect(rows[0]).toEqual({ body: MENTOR_ALLOWANCE_TERMS_BODY, status: "published" });
    expect(MENTOR_ALLOWANCE_TERMS_BODY).not.toMatch(/attorney|lawyer|approved by counsel/i);
  });

  it("allows only the add-on amounts on offer, with a Stripe item when there is one", async () => {
    await expect(q("update public.subscriptions set mentor_addon_cents = 700, mentor_addon_item_id = 'si_1' where id = $1", [sub])).rejects.toThrow(/subscriptions_mentor_addon_amount/);
    await expect(q("update public.subscriptions set mentor_addon_cents = 500 where id = $1", [sub])).rejects.toThrow(/subscriptions_mentor_addon_item/);
    await q("update public.subscriptions set mentor_addon_cents = 500, mentor_addon_item_id = 'si_1' where id = $1", [sub]);
  });

  it("keeps one allowance row per period, and the ledger as recorded", async () => {
    const period = (await q(`insert into public.mentor_allowance_periods (subscription_id, account_id, period_start, period_end, addon_cents)
      values ($1, $2, '2026-10-01', '2026-11-01', 500) returning id`, [sub, learner])).rows[0].id;
    await expect(q(`insert into public.mentor_allowance_periods (subscription_id, account_id, period_start, period_end) values ($1, $2, '2026-10-01', '2026-11-01')`, [sub, learner])).rejects.toThrow(/duplicate key/);
    const use = (await q(`insert into public.mentor_allowance_usage (period_id, account_id, cost_usd, counted_usd) values ($1, $2, 0.004, 0.004) returning id`, [period, learner])).rows[0].id;
    await expect(q("update public.mentor_allowance_usage set counted_usd = 0 where id = $1", [use])).rejects.toThrow(/kept as recorded/);
    await expect(q(`insert into public.mentor_allowance_usage (period_id, account_id, cost_usd, counted_usd, price_scale) values ($1, $2, 0.01, 0.005, 0.5)`, [period, learner])).rejects.toThrow(/check/);
  });

  it("accepts the Guardian's 80% and 100% allowance notices", async () => {
    for (const kind of ["mentor_allowance_80", "mentor_allowance_100"]) {
      await q("insert into public.notices (account_id, kind, dedupe_key, status) values ($1, $2, $3, 'skipped')", [learner, kind, `${kind}:x`]);
    }
    await expect(q("insert into public.notices (account_id, kind, dedupe_key) values ($1, 'mentor_allowance_50', 'y')", [learner])).rejects.toThrow(/notices_kind_check/);
  });

  it("keeps the new tables away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.mentor_allowance_periods', 'select') as p,
      has_table_privilege('anon', 'public.mentor_allowance_usage', 'select') as u`);
    expect(rows[0]).toEqual({ p: false, u: false });
  });

  it("refuses L5 on a database without L4", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0015")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L5.sql"))).rejects.toThrow(/apply L4 \(0015\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
