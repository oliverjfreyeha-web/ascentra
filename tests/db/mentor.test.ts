import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L4 (0015): the Mentor's and the safety queue's rules, held by the database, applied as the bundle to a live L3 database. */
describe("the L4 bundle on the live L3 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string;
  let learner: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0015")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
    owner = await acc("user_owner", "owner");
    learner = await acc("user_learner", "learner");
    await q(readSql("db/apply/L4.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql says L4 is applied (L5 not yet)", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 2 missing.*L4 applied, L5 NOT applied$/);
  });

  it("counts Mentor messages per account per day, atomically", async () => {
    const count = async () => (await q("select public.count_mentor_message($1, '2026-10-06') as n", [learner])).rows[0].n;
    expect([await count(), await count(), await count()]).toEqual([1, 2, 3]);
    expect((await q("select public.count_mentor_message($1, '2026-10-07') as n", [learner])).rows[0].n).toBe(1);
  });

  it("a thread holds an array of messages and can be deleted by its owner's request (privacy)", async () => {
    await expect(q("insert into public.mentor_threads (account_id, messages) values ($1, '{}')", [learner])).rejects.toThrow(/mentor_threads_messages_array/);
    const t = (await q(`insert into public.mentor_threads (account_id, messages, title) values ($1, '[{"role":"learner","text":"hi"}]', 'Hi') returning id`, [learner])).rows[0].id;
    const ev = (await q(`insert into public.safety_events (subject_account_id, category, reason, stage, thread_id) values ($1, 'self_harm', 'Self-harm signal in a Mentor message', 'input', $2) returning id`, [learner, t])).rows[0].id;
    await q("delete from public.mentor_threads where id = $1", [t]);
    expect((await q("select thread_id from public.safety_events where id = $1", [ev])).rows[0].thread_id).toBeNull();
  });

  it("a safety event is kept as recorded, uses known categories, and is reviewed once by the Owner or an admin", async () => {
    await expect(q("insert into public.safety_events (subject_account_id, category, reason) values ($1, 'gossip', 'x')", [learner])).rejects.toThrow(/safety_events_category/);
    const id = (await q(`insert into public.safety_events (subject_account_id, category, reason, stage, is_minor, priority, severity)
      values ($1, 'abuse', 'Abuse signal in a teen''s Mentor message', 'input', true, 0, 'urgent') returning id`, [learner])).rows[0].id;
    await expect(q("update public.safety_events set reason = 'changed' where id = $1", [id])).rejects.toThrow(/kept as recorded/);
    await expect(q("delete from public.safety_events where id = $1", [id])).rejects.toThrow(/kept/);
    await expect(q("update public.safety_events set status = 'reviewed' where id = $1", [id])).rejects.toThrow(/safety_events_reviewed|only the Owner or a Super Admin/);
    await expect(q("update public.safety_events set status = 'reviewed', acknowledged_at = now(), acknowledged_by_account_id = $2 where id = $1", [id, learner])).rejects.toThrow(/only the Owner or a Super Admin/);
    await q("update public.safety_events set status = 'reviewed', acknowledged_at = now(), acknowledged_by_account_id = $2, review_note = 'Followed up' where id = $1", [id, owner]);
    await expect(q("update public.safety_events set review_note = 'again' where id = $1", [id])).rejects.toThrow(/already reviewed/);
  });

  it("keeps the new table and function away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.mentor_daily_usage', 'select') as u,
      has_function_privilege('authenticated', 'public.count_mentor_message(uuid, date)', 'execute') as f`);
    expect(rows[0]).toEqual({ u: false, f: false });
  });

  it("refuses L4 on a database without L3", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0014")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L4.sql"))).rejects.toThrow(/apply L3 \(0014\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
