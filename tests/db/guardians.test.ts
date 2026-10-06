import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";
import { TEEN_DOCUMENTS } from "../../lib/teen-documents";

/** B3 (0010): the Guardian rules held by the database itself, applied as the SQL Editor bundle to a live B2 database. */
describe("the B3 bundle on the live B2 database (Owner, an admin, a pending teen with an invitation)", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let n = 0;
  const teen = async () => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, status, is_minor, date_of_birth, clerk_updated_at)
      values ($1, $2, true, 'learner', 'pending', true, (private.us_today() - interval '15 years')::date, now()) returning id`,
  [`user_teen_${++n}`, `teen${n}@example.com`])).rows[0].id as string;
  const guardian = async (identity = "none") => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, identity_status, identity_verified_at, clerk_updated_at)
      values ($1, $2, true, 'guardian', $3, case when $3 = 'verified' then now() end, now()) returning id`,
  [`user_g_${++n}`, `g${n}@example.com`, identity])).rows[0].id as string;
  const link = (t: string, g: string | null, status = "pending") => q(
    `insert into public.guardian_relationships (teen_account_id, guardian_account_id, invited_email, verification_status, authorized_at)
     values ($1, $2, 'parent@example.com', $3, case when $3 = 'verified' then now() end) returning id`, [t, g, status]);
  let invitedTeen: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0010")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
             values ('user_live_owner', 'owner@example.com', true, 'owner', now(), true),
                    ('user_live_admin', 'admin@example.com', true, 'admin', now(), true)`);
    invitedTeen = await teen();
    await q(`insert into public.guardian_relationships (teen_account_id, invited_email, invited_at, verification_status) values ($1, 'mom@example.com', now(), 'invited')`, [invitedTeen]);
    await q(readSql("db/apply/B3.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; the B2 invitation and verify.sql are fine afterwards", async () => {
    expect((await q("select verification_status, invited_email, voice_recordings, uploads from public.guardian_relationships")).rows)
      .toEqual([{ verification_status: "invited", invited_email: "mom@example.com", voice_recordings: "off", uploads: "private" }]);
    expect((await q("select identity_status from public.accounts where role = 'owner'")).rows[0].identity_status).toBe("none");
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 21 missing.*B3 applied, B4 NOT applied, L1 NOT applied, L2 NOT applied, L3 NOT applied, L4 NOT applied, L5 NOT applied, L6 NOT applied, L7 NOT applied$/);
  });

  it("publishes the Teen Terms and the Minor Privacy Notice word for word as the Guardian sees them", async () => {
    for (const [key, doc] of Object.entries(TEEN_DOCUMENTS)) {
      const { rows } = await q("select title, body, status from public.legal_document_versions where document_key = $1 and version = $2", [key, doc.version]);
      expect(rows, key).toEqual([{ title: doc.title, body: doc.body, status: "published" }]);
    }
  });

  it("gives a teen exactly one Guardian of record; one Guardian can link several teens", async () => {
    const g = await guardian("verified");
    await expect(link(invitedTeen, g)).rejects.toThrow(/guardian_relationships_one_of_record/);
    const [t1, t2] = [await teen(), await teen()];
    await expect(link(t1, g)).resolves.toBeDefined();
    await expect(link(t2, g)).resolves.toBeDefined();
    await expect(link(t1, await guardian("verified"))).rejects.toThrow(/guardian_relationships_one_of_record/);
  });

  it("only a Guardian account can be linked, and only a verified one can authorize", async () => {
    const t = await teen();
    const admin = (await q("select id from public.accounts where role = 'admin'")).rows[0].id;
    await expect(link(t, admin)).rejects.toThrow(/only a Guardian account/);
    await expect(link(t, await guardian("processing"), "verified")).rejects.toThrow(/identity and adult check/);
    const g = await guardian("verified");
    const rel = (await link(t, g)).rows[0].id;
    await expect(q("update public.guardian_relationships set verification_status = 'verified' where id = $1", [rel])).rejects.toThrow(/guardian_relationships_verified_check/);
    await q("update public.guardian_relationships set verification_status = 'verified', authorized_at = now() where id = $1", [rel]);
    await q("update public.accounts set status = 'active' where id = $1", [t]);
    expect((await q("select status from public.accounts where id = $1", [t])).rows[0].status).toBe("active");
  });

  it("keeps identity results for Guardians only, with a date when verified", async () => {
    await expect(q("update public.accounts set identity_status = 'verified', identity_verified_at = now() where role = 'admin'")).rejects.toThrow(/accounts_identity_guardian/);
    const g = await guardian();
    await expect(q("update public.accounts set identity_status = 'verified' where id = $1", [g])).rejects.toThrow(/accounts_identity_verified_at/);
  });

  it("withdrawal pauses the teen; the teen can't be made active again on a withdrawn link", async () => {
    const t = await teen();
    const g = await guardian("verified");
    const rel = (await link(t, g, "verified")).rows[0].id;
    await q("update public.accounts set status = 'active' where id = $1", [t]);
    await expect(q("update public.guardian_relationships set withdrawn_at = now() where id = $1", [rel])).rejects.toThrow(/guardian_relationships_withdrawal_check/);
    await q("update public.guardian_relationships set withdrawn_at = now(), withdrawal_reason = 'Changed my mind' where id = $1", [rel]);
    await q("update public.accounts set status = 'paused' where id = $1", [t]);
    await expect(q("update public.accounts set status = 'active' where id = $1", [t])).rejects.toThrow(/stays pending/);
    // The withdrawn link no longer counts: a new Guardian could be linked later.
    await expect(link(t, await guardian())).resolves.toBeDefined();
  });

  it("never pauses the Owner or an admin", async () => {
    await expect(q("update public.accounts set status = 'paused' where role = 'admin'")).rejects.toThrow(/accounts_pending_is_learner/);
    await expect(q("update public.accounts set status = 'paused' where role = 'owner'")).rejects.toThrow(/demoted or suspended|accounts_pending_is_learner/);
  });

  it("refuses B3 on a database without B2", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0009")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/B3.sql"))).rejects.toThrow(/apply B2 \(0009\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
