import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** S2 (0024): the 18th-birthday switch held by the database, applied as the SQL Editor bundle to a live S1 database. */
describe("the S2 bundle on the live S1 database (a teen who turns 18, one who doesn't yet, a paused teen)", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let n = 0;
  /** A date `years` years before the US date today, plus `days` days. */
  const dob = async (years: number, days = 0) =>
    (await q(`select to_char((private.us_today() - make_interval(years => $1::int) + make_interval(days => $2::int))::date, 'YYYY-MM-DD') as d`, [years, days])).rows[0].d as string;
  const teen = async (birth: string) => (await q(
    `insert into public.accounts (clerk_user_id, email, email_verified, role, status, is_minor, date_of_birth, clerk_updated_at)
     values ($1, $2, true, 'learner', 'pending', true, $3, now()) returning id`, [`user_t_${++n}`, `t${n}@example.com`, birth])).rows[0].id as string;
  const guardian = async () => (await q(
    `insert into public.accounts (clerk_user_id, email, email_verified, role, identity_status, identity_verified_at, clerk_updated_at)
     values ($1, $2, true, 'guardian', 'verified', now(), now()) returning id`, [`user_g_${++n}`, `g${n}@example.com`])).rows[0].id as string;
  /** An active teen with a verified Guardian. */
  const activeTeen = async (birth: string) => {
    const t = await teen(birth);
    const g = await guardian();
    await q(`insert into public.guardian_relationships (teen_account_id, guardian_account_id, invited_email, verification_status, authorized_at)
             values ($1, $2, 'parent@example.com', 'verified', now())`, [t, g]);
    await q("update public.accounts set status = 'active' where id = $1", [t]);
    return { t, g };
  };
  const age = (id: string) => q("select * from public.age_up_account($1) as r", [id]).then((r) => r.rows[0].r as string);

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0024")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    await q(readSql("db/apply/S2.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go and refuses to run twice", async () => {
    await expect(q(readSql("db/apply/S2.sql"))).rejects.toThrow(/already applied/);
    await q("rollback"); // the bundle's own begin; left a failed transaction open
  });

  it("is callable by the server only", async () => {
    const r = await q(`select has_function_privilege('anon', 'public.age_up_account(uuid)', 'execute') as anon,
                              has_function_privilege('authenticated', 'public.age_up_account(uuid)', 'execute') as authed,
                              has_function_privilege('service_role', 'public.age_up_account(uuid)', 'execute') as server`);
    expect(r.rows[0]).toEqual({ anon: false, authed: false, server: true });
  });

  it("does not switch a teen who is still 17 (the day before the birthday)", async () => {
    const { t } = await activeTeen(await dob(18, 1));
    expect(await age(t)).toBe("not_yet");
    expect((await q("select is_minor, aged_up_at from public.accounts where id = $1", [t])).rows[0]).toEqual({ is_minor: true, aged_up_at: null });
  });

  it("switches an active teen on the day: adult, Guardian link closed, agreement due", async () => {
    // Born exactly 18 years ago today; stored as a teen because they were 17 when they signed up (the date is moved
    // back by the test, as time would).
    const { t, g } = await activeTeen(await dob(17, 1));
    await q("alter table public.accounts disable trigger check_account_age");
    await q("update public.accounts set date_of_birth = $2 where id = $1", [t, await dob(18)]);
    await q("alter table public.accounts enable trigger check_account_age");
    expect(await age(t)).toBe("aged_up");
    const a = (await q("select is_minor, aged_up_at is not null as aged, adult_agreement_due, status from public.accounts where id = $1", [t])).rows[0];
    expect(a).toEqual({ is_minor: false, aged: true, adult_agreement_due: true, status: "active" });
    const l = (await q("select withdrawn_at is not null as closed, withdrawal_reason, verification_status from public.guardian_relationships where teen_account_id = $1 and guardian_account_id = $2", [t, g])).rows[0];
    expect(l).toEqual({ closed: true, withdrawal_reason: "learner_turned_18", verification_status: "verified" });
  });

  it("changes nothing the second time", async () => {
    const { t } = await activeTeen(await dob(17, 1));
    await q("alter table public.accounts disable trigger check_account_age");
    await q("update public.accounts set date_of_birth = $2 where id = $1", [t, await dob(18)]);
    await q("alter table public.accounts enable trigger check_account_age");
    expect(await age(t)).toBe("aged_up");
    const first = (await q("select aged_up_at from public.accounts where id = $1", [t])).rows[0].aged_up_at;
    expect(await age(t)).toBe("not_a_teen");
    expect((await q("select aged_up_at from public.accounts where id = $1", [t])).rows[0].aged_up_at).toEqual(first);
  });

  it("holds a teen whose account is paused instead of switching it", async () => {
    const { t } = await activeTeen(await dob(17, 1));
    await q("alter table public.accounts disable trigger check_account_age");
    await q("update public.accounts set date_of_birth = $2, status = 'paused' where id = $1", [t, await dob(18)]);
    await q("alter table public.accounts enable trigger check_account_age");
    expect(await age(t)).toBe("held_status");
    expect((await q("select is_minor from public.accounts where id = $1", [t])).rows[0].is_minor).toBe(true);
  });

  it("refuses an adult, an admin and an unknown id", async () => {
    const adult = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, status, is_minor, date_of_birth, clerk_updated_at)
      values ('user_adult', 'adult@example.com', true, 'learner', 'active', false, $1, now()) returning id`, [await dob(30)])).rows[0].id as string;
    expect(await age(adult)).toBe("not_a_teen");
    const admin = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ('user_adm', 'adm@example.com', true, 'admin', now(), true) returning id`)).rows[0].id as string;
    expect(await age(admin)).toBe("not_a_teen");
    expect(await age("00000000-0000-0000-0000-000000000000")).toBe("not_found");
  });

  it("lists active teens who turn 18 within 30 days, and nobody else", async () => {
    const soon = (await activeTeen(await dob(18, 20))).t; // 18th birthday in 20 days
    const far = (await activeTeen(await dob(18, 90))).t; // in 90 days
    const ids = (await q("select account_id from public.age_up_candidates()")).rows.map((r) => r.account_id);
    expect(ids).toContain(soon);
    expect(ids).not.toContain(far);
  });

  it("keeps is_minor and aged_up_at consistent", async () => {
    const { t } = await activeTeen(await dob(16));
    await expect(q("update public.accounts set aged_up_at = now() where id = $1", [t])).rejects.toThrow(/accounts_aged_up_is_adult/);
  });

  it("accepts the two new notice kinds and still refuses an unknown one", async () => {
    const a = (await q("select id from public.accounts where role = 'learner' limit 1")).rows[0].id as string;
    for (const kind of ["turning_18_notice", "turned_18"]) {
      await q("insert into public.notices (account_id, kind, dedupe_key) values ($1, $2, $3)", [a, kind, `test:${kind}`]);
    }
    await expect(q("insert into public.notices (account_id, kind, dedupe_key) values ($1, 'nope', 'test:nope')", [a])).rejects.toThrow(/notices_kind_check/);
  });
});
