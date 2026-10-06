import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L3 (0014): the freshness cycle's rules, held by the database, applied as the SQL Editor bundle to a live L2 database. */
describe("the L3 bundle on the live L2 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string;
  let reviewer: string;
  let learner: string;
  let academy: string;
  let lesson: string;
  let published: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0014")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
    owner = await acc("user_owner", "owner");
    reviewer = await acc("user_reviewer", "admin");
    learner = await acc("user_learner", "learner");
    await q(readSql("db/apply/L3.sql"));
    academy = (await q("insert into public.academies (slug, name) values ('leads', 'Lead response') returning id")).rows[0].id;
    const course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
    const mod = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Basics') returning id", [course])).rows[0].id;
    lesson = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Speed') returning id", [mod])).rows[0].id;
    published = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, created_by_account_id)
      values ($1, $2, 1, 'Speed', '{"sections": []}', $3) returning id`, [lesson, course, owner])).rows[0].id;
    await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [published, owner]);
    await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2 where id = $1", [published, reviewer]);
    await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [published, owner]);
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql says L3 is applied (L4 not yet)", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 1 missing.*L3 applied, L4 NOT applied$/);
  });

  it("the refresh interval is 30 to 60 days, 42 by default", async () => {
    const id = (await q("insert into public.course_refresh (academy_id) values ($1) returning id, refresh_days", [academy])).rows[0];
    expect(id.refresh_days).toBe(42);
    await expect(q("update public.course_refresh set refresh_days = 29 where academy_id = $1", [academy])).rejects.toThrow(/refresh_days_check/);
    await expect(q("update public.course_refresh set refresh_days = 61 where academy_id = $1", [academy])).rejects.toThrow(/refresh_days_check/);
    await q("update public.course_refresh set refresh_days = 30 where academy_id = $1", [academy]);
  });

  it("one open change report per course; a suggested edit is cited, decided once by the Owner or a Reviewer, and never rewritten", async () => {
    const run = (await q("insert into public.refresh_runs (academy_id, trigger, status) values ($1, 'scheduled', 'ready') returning id", [academy])).rows[0].id;
    await expect(q("insert into public.refresh_runs (academy_id, trigger) values ($1, 'manual')", [academy])).rejects.toThrow(/refresh_runs_one_open/);
    const edit = (src: unknown[]) => q(`insert into public.refresh_edits (refresh_run_id, lesson_id, base_version_id, location, old_text, new_text, sources, reason)
      values ($1, $2, $3, 'S1.P1', 'old', 'new', $4::jsonb, 'Newer guidance') returning id`, [run, lesson, published, JSON.stringify(src)]);
    await expect(edit([])).rejects.toThrow(/refresh_edits_sources_check/);
    const id = (await edit([{ sourceId: "x", title: "Study", url: "https://example.org" }])).rows[0].id;
    await expect(q("update public.refresh_edits set new_text = 'other' where id = $1", [id])).rejects.toThrow(/isn't changed/);
    await expect(q("update public.refresh_edits set status = 'approved', decided_at = now(), decided_by_account_id = $2 where id = $1", [id, learner])).rejects.toThrow(/only the Owner or a Reviewer/);
    await q("update public.refresh_edits set status = 'approved', decided_at = now(), decided_by_account_id = $2 where id = $1", [id, reviewer]);
    await expect(q("update public.refresh_edits set status = 'rejected' where id = $1", [id])).rejects.toThrow(/already approved/);
    await expect(q("delete from public.refresh_edits where id = $1", [id])).rejects.toThrow(/kept/);
    await expect(q("update public.refresh_runs set status = 'reviewed' where id = $1", [run])).rejects.toThrow(/refresh_runs_reviewed/);
    await q("update public.refresh_runs set status = 'reviewed', reviewed_at = now(), reviewed_by_account_id = $2 where id = $1", [run, reviewer]);
    await expect(q("insert into public.refresh_runs (academy_id, trigger) values ($1, 'manual')", [academy])).resolves.toBeDefined();
  });

  it("a refresh draft is a new version; the published one is untouched; research can run without an account", async () => {
    const course = (await q("select course_id from public.lesson_versions where id = $1", [published])).rows[0].course_id;
    const run = (await q("select id from public.refresh_runs where status = 'running'")).rows[0].id;
    const d = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, created_by_account_id, refresh_run_id, change_summary)
      values ($1, $2, 2, 'Speed', '{"sections": [1]}', $3, $4, 'Updated: newer guidance') returning status`, [lesson, course, reviewer, run])).rows[0];
    expect(d.status).toBe("draft");
    await expect(q(`update public.lesson_versions set body = '{"changed": true}' where id = $1`, [published])).rejects.toThrow(/only a Draft can be changed/);
    await expect(q(`insert into public.research_runs (topic, audience_level, freshness_question, status, model, refresh_run_id)
      values ('Lead response', 'beginner', 'What changed?', 'completed', 'claude-haiku-4-5', $1)`, [run])).resolves.toBeDefined();
  });

  it("keeps the new tables away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.refresh_edits', 'select') as e,
      has_table_privilege('anon', 'public.course_refresh', 'select') as c`);
    expect(rows[0]).toEqual({ e: false, c: false });
  });

  it("refuses L3 on a database without L2", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0013")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L3.sql"))).rejects.toThrow(/apply L2 \(0013\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
