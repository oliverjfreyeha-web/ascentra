import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** B2 (0009): the age rules held by the database itself, applied as the SQL Editor bundle to a live B1 database. */
describe("the B2 bundle on the live B1 database (Owner, an admin, the adult test learner)", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  /** A date `years` years (and `days` days) before today in the westernmost US time zone. */
  const yearsAgo = async (years: number, days = 0) =>
    (await q(`select to_char((private.us_today() - make_interval(years => $1::int) + make_interval(days => $2::int))::date, 'YYYY-MM-DD') as d`, [years, days])).rows[0].d as string;
  let n = 0;
  const learner = (o: { dob?: string | null; minor?: boolean; status?: string; role?: string } = {}) =>
    q(`insert into public.accounts (clerk_user_id, email, email_verified, role, status, is_minor, date_of_birth, clerk_updated_at)
       values ($1, $2, true, $3, $4, $5, $6, now()) returning id`,
      [`user_b2_${++n}`, `b2.${n}@example.com`, o.role ?? "learner", o.status ?? "active", o.minor ?? false, o.dob ?? null]);

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0009")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
             values ('user_live_owner', 'owner@example.com', true, 'owner', now(), true),
                    ('user_live_admin', 'admin@example.com', true, 'admin', now(), true),
                    ('user_test_learner', 'learner@example.com', true, 'learner', now(), true)`);
    await q(`insert into public.audit_events (actor_label, action) values ('System', 'b1 event')`);
    await q(readSql("db/apply/B2.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; existing accounts, the audit chain and verify.sql are fine afterwards", async () => {
    expect((await q("select role, status, is_minor, date_of_birth from public.accounts order by clerk_user_id")).rows).toEqual([
      { role: "admin", status: "active", is_minor: false, date_of_birth: null },
      { role: "owner", status: "active", is_minor: false, date_of_birth: null },
      { role: "learner", status: "active", is_minor: false, date_of_birth: null },
    ]);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 24 missing.*B2 applied, B3 NOT applied, B4 NOT applied, L1 NOT applied, L2 NOT applied, L3 NOT applied, L4 NOT applied, L5 NOT applied, L6 NOT applied, L7 NOT applied, L8 NOT applied$/);
  });

  it("never stores anyone under 14, and counts a birthday only once it has come everywhere in the US", async () => {
    await expect(learner({ dob: await yearsAgo(12), minor: true, status: "pending" })).rejects.toThrow(/14 and older/);
    await expect(learner({ dob: await yearsAgo(14, 1), minor: true, status: "pending" })).rejects.toThrow(/14 and older/);
    await expect(learner({ dob: await yearsAgo(14), minor: true, status: "pending" })).resolves.toBeDefined();
    await expect(learner({ dob: "2999-01-01" })).rejects.toThrow(/real date of birth/);
  });

  it("makes is_minor match the date of birth, and keeps a teen pending until a verified Guardian", async () => {
    await expect(learner({ dob: await yearsAgo(15), minor: false })).rejects.toThrow(/is_minor must match/);
    await expect(learner({ dob: await yearsAgo(30), minor: true, status: "pending" })).rejects.toThrow(/is_minor must match/);
    await expect(learner({ dob: await yearsAgo(15), minor: true, status: "active" })).rejects.toThrow(/stays pending/);
    const teen = (await learner({ dob: await yearsAgo(15), minor: true, status: "pending" })).rows[0].id;
    await expect(q("update public.accounts set status = 'active' where id = $1", [teen])).rejects.toThrow(/stays pending/);
    await expect(learner({ dob: await yearsAgo(18), minor: false })).resolves.toBeDefined();
  });

  it("never makes the Owner or an admin pending, a minor, or gives them a date of birth", async () => {
    await expect(q("update public.accounts set status = 'pending' where role = 'admin'")).rejects.toThrow(/accounts_pending_is_learner/);
    await expect(q("update public.accounts set status = 'pending' where role = 'owner'")).rejects.toThrow(/demoted or suspended|accounts_pending_is_learner/);
    await expect(q("update public.accounts set is_minor = true where role = 'admin'")).rejects.toThrow(/accounts_minor_role_check|stays pending/);
    await expect(q("update public.accounts set date_of_birth = '1990-01-01' where role = 'owner'")).rejects.toThrow(/accounts_date_of_birth_role/);
    await expect(learner({ role: "admin", status: "pending" })).rejects.toThrow(/accounts_pending_is_learner/);
  });

  it("refuses a direct change to a date of birth; Support's function corrects it within the same age group only", async () => {
    const dob = await yearsAgo(16);
    const teen = (await learner({ dob, minor: true, status: "pending" })).rows[0].id;
    await expect(q("update public.accounts set date_of_birth = $2 where id = $1", [teen, await yearsAgo(17)])).rejects.toThrow(/can't be changed/);
    const change = async (d: string) => (await q("select public.support_change_date_of_birth($1, $2) as r", [teen, d])).rows[0].r;
    expect(await change(dob)).toBe("unchanged");
    expect(await change(await yearsAgo(25))).toBe("changes_age_group");
    expect(await change(await yearsAgo(12))).toBe("changes_age_group");
    expect(await change("2999-01-01")).toBe("invalid");
    const fixed = await yearsAgo(17);
    expect(await change(fixed)).toBe("changed");
    expect((await q("select to_char(date_of_birth, 'YYYY-MM-DD') as d from public.accounts where id = $1", [teen])).rows[0].d).toBe(fixed);
    // The permission is local to the function: straight after it, a direct change is refused again.
    await expect(q("update public.accounts set date_of_birth = $2 where id = $1", [teen, dob])).rejects.toThrow(/can't be changed/);
    expect((await q("select public.support_change_date_of_birth(id, '1990-01-01') as r from public.accounts where role = 'owner'")).rows[0].r).toBe("no_date_of_birth");
  });

  it("keeps the date of birth and Support's function away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_column_privilege('authenticated', 'public.accounts', 'date_of_birth', 'select') as col,
      has_function_privilege('anon', 'public.support_change_date_of_birth(uuid, date)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.support_change_date_of_birth(uuid, date)', 'execute') as auth,
      has_function_privilege('service_role', 'public.support_change_date_of_birth(uuid, date)', 'execute') as service`);
    expect(rows[0]).toEqual({ col: false, anon: false, auth: false, service: true });
  });

  it("stores a Guardian invitation without a Guardian account: one open invitation per teen, teens only", async () => {
    const teen = (await learner({ dob: await yearsAgo(15), minor: true, status: "pending" })).rows[0].id;
    const invite = (id: string, email = "parent@example.com") => q(
      `insert into public.guardian_relationships (teen_account_id, invited_email, invited_at, verification_status) values ($1, $2, now(), 'invited')`, [id, email]);
    await expect(invite(teen)).resolves.toBeDefined();
    await expect(invite(teen, "other@example.com")).rejects.toThrow(/guardian_relationships_one_open_invite/);
    const adult = (await learner({ dob: await yearsAgo(30) })).rows[0].id;
    await expect(invite(adult)).rejects.toThrow(/only for a teen/);
    await expect(q(`insert into public.guardian_relationships (teen_account_id, verification_status) values ($1, 'pending')`, [teen]))
      .rejects.toThrow(/guardian_relationships_invited_check/);
  });

  it("refuses B2 on a database without B1", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0008")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/B2.sql"))).rejects.toThrow(/apply B1 \(0008\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
