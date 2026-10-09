import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L7 (0018): the interview, the personalized path and the anonymous course requests, held by the database. */
describe("the L7 bundle on the live L6 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let learner: string;
  let admin: string;
  let published: string;
  let draftOnly: string;
  let gsa: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0018")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    learner = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
      values ('user_learner', 'learner@example.com', true, 'learner', now()) returning id`)).rows[0].id;
    admin = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ('user_owner', 'owner@example.com', true, 'owner', now(), true) returning id`)).rows[0].id;
    await q(readSql("db/apply/L7.sql"));
    // A course with a published lesson, one with only a draft, and the Owner Academy.
    const course = async (slug: string, publish: boolean) => {
      const a = (await q("insert into public.academies (slug, name) values ($1, $1) returning id", [slug])).rows[0].id;
      const c = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, $2) returning id", [a, publish ? "published" : "draft"])).rows[0].id;
      const m = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'M') returning id", [c])).rows[0].id;
      const l = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'L') returning id", [m])).rows[0].id;
      // Through the L2 review order: draft, review, verified, published.
      const v = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, created_by_account_id) values ($1, $2, 1, 'L', '{}', $3) returning id`, [l, c, admin])).rows[0].id;
      if (publish) {
        await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v, admin]);
        await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2 where id = $1", [v, admin]);
        await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [v, admin]);
      }
      return a as string;
    };
    published = await course("leads", true);
    draftOnly = await course("drafty", false);
    gsa = await course("gsa", true);
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql finds L7 in place (and L8 not yet applied)", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 3 missing.*L7 applied, L8 NOT applied$/);
  });

  it("the interview is answered in full or skipped, with short list values only", async () => {
    await expect(q("insert into public.learner_interviews (account_id, goal, completed_at) values ($1, 'basics', now())", [learner])).rejects.toThrow(/learner_interviews_state/);
    await expect(q("insert into public.learner_interviews (account_id, goal, level, minutes_per_week, completed_at) values ($1, 'basics', 'beginner', 90, now())", [learner])).rejects.toThrow(/check/);
    await expect(q(`insert into public.learner_interviews (account_id, goal, level, minutes_per_week, topics, completed_at) values ($1, 'basics', 'beginner', 60, '{"my name is Sam"}', now())`, [learner])).rejects.toThrow(/learner_interviews_short_values/);
    await q(`insert into public.learner_interviews (account_id, goal, level, minutes_per_week, topics, interests, completed_at) values ($1, 'apply', 'beginner', 120, '{leads}', '{home-services}', now())`, [learner]);
    await expect(q("insert into public.learner_interviews (account_id, skipped_at) values ($1, now())", [learner])).rejects.toThrow(/duplicate key/);
  });

  it("a path holds only published courses, never the Owner Academy", async () => {
    const path = (await q("insert into public.learner_paths (account_id, method) values ($1, 'rules') returning id", [learner])).rows[0].id;
    const item = (academy: string, position = 1) => q("insert into public.learner_path_items (path_id, account_id, academy_id, position, reason) values ($1, $2, $3, $4, 'You chose it')", [path, learner, academy, position]);
    await expect(item(draftOnly)).rejects.toThrow(/only published courses/);
    await expect(item(gsa)).rejects.toThrow(/Owner Academy/);
    await item(published);
    await expect(item(published, 2)).rejects.toThrow(/duplicate key/);
  });

  it("course requests are anonymous and counted; a dismissed topic asked again goes back to the queue", async () => {
    const ask = async () => (await q("select public.request_course('Beekeeping basics', 'beekeeping-basics', 'beginner') as id")).rows[0].id;
    const id = await ask();
    expect(await ask()).toBe(id);
    expect((await q("select request_count, status from public.course_requests where id = $1", [id])).rows[0]).toEqual({ request_count: 2, status: "open" });
    await q("update public.course_requests set status = 'dismissed', decided_at = now() where id = $1", [id]);
    await ask();
    expect((await q("select request_count, status, decided_at from public.course_requests where id = $1", [id])).rows[0]).toEqual({ request_count: 3, status: "open", decided_at: null });
    const cols = (await q("select column_name from information_schema.columns where table_name = 'course_requests'")).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /account|email|name/.test(c))).toEqual(["decided_by_account_id"]);
  });

  it("keeps the new tables and the request function away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.learner_interviews', 'select') as i,
      has_table_privilege('anon', 'public.course_requests', 'select') as r,
      has_function_privilege('authenticated', 'public.request_course(text, text, text)', 'execute') as f`);
    expect(rows[0]).toEqual({ i: false, r: false, f: false });
  });

  it("refuses L7 on a database without L6", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0017")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L7.sql"))).rejects.toThrow(/apply L6 \(0017\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
