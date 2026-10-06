import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L2 (0013): course generation's rules, held by the database, applied as the SQL Editor bundle to a live L1 database. */
describe("the L2 bundle on the live L1 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string;
  let reviewer: string;
  let learner: string;
  let course: string;
  let lesson: string;
  let source: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0013")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
    owner = await acc("user_owner", "owner");
    reviewer = await acc("user_reviewer", "admin");
    learner = await acc("user_learner", "learner");
    await q(readSql("db/apply/L2.sql"));
    const academy = (await q("insert into public.academies (slug, name) values ('leads', 'Lead response') returning id")).rows[0].id;
    course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
    const mod = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Basics') returning id", [course])).rows[0].id;
    lesson = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Speed to lead') returning id", [mod])).rows[0].id;
    source = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
      values ('Study', 'web', 'https://example.org/s', 'approved', $1, now()) returning id`, [reviewer])).rows[0].id;
  });
  afterAll(() => db.drop());

  const draft = (version: number, citations: unknown[] = []) => q(
    `insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, created_by_account_id)
     values ($1, $2, $3, 'Speed to lead', '{"sections": []}', $4::jsonb, $5) returning id`,
    [lesson, course, version, JSON.stringify(citations), owner]);
  const set = (id: string, fields: string, args: unknown[] = []) => q(`update public.lesson_versions set ${fields} where id = $1`, [id, ...args]);
  const status = async (id: string) => (await q("select status from public.lesson_versions where id = $1", [id])).rows[0].status;

  it("applies in one go; verify.sql says L2 is applied (L3 not yet)", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 14 missing.*L2 applied, L3 NOT applied, L4 NOT applied, L5 NOT applied, L6 NOT applied, L7 NOT applied$/);
  });

  it("a course blueprint needs its plan; once approved it can't be changed", async () => {
    const academy = (await q("select academy_id from public.courses where id = $1", [course])).rows[0].academy_id;
    await expect(q("insert into public.academy_blueprints (account_id, academy_id, kind) values ($1, $2, 'course')", [owner, academy]))
      .rejects.toThrow(/academy_blueprints_course_shape/);
    const id = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by)
      values ($1, $2, 'course', 'Lead response', 'beginner', '{"modules": []}', 'ai') returning id`, [owner, academy])).rows[0].id;
    await expect(q("update public.academy_blueprints set status = 'approved', approved_at = now() where id = $1", [id])).rejects.toThrow(/academy_blueprints_course_approved/);
    await q("update public.academy_blueprints set status = 'approved', approved_at = now(), approved_by_account_id = $2, course_id = $3 where id = $1", [id, owner, course]);
    await expect(q(`update public.academy_blueprints set plan = '{"modules": [1]}' where id = $1`, [id])).rejects.toThrow(/can't be changed/);
    await expect(q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan)
      values ($1, $2, 'course', 'x', 'beginner', '{"note": "attorney-approved"}')`, [owner, academy])).rejects.toThrow(/not_attorney/);
  });

  it("approving a blueprint creates the next Draft course version with its modules, lessons and skills, in one go", async () => {
    const academy = (await q("select academy_id from public.courses where id = $1", [course])).rows[0].academy_id;
    const plan = { outcome: "Answer leads fast", modules: [{ title: "Speed", stage: "Foundations",
      lessons: [{ title: "Why minutes matter", minutes: 12, objectives: ["Explain the drop-off"], keyClaims: [{ claim: "Fast replies convert more.", sourceId: source }, { claim: "Uncited." }] }],
      skills: [{ key: "response", name: "Response time" }] }] };
    const bp = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by)
      values ($1, $2, 'course', 'Lead response', 'beginner', $3, 'ai') returning id`, [owner, academy, JSON.stringify(plan)])).rows[0].id;
    const created = (await q("select public.approve_course_blueprint($1, $2) as id", [bp, owner])).rows[0].id;
    expect((await q("select version, status, summary from public.courses where id = $1", [created])).rows[0]).toEqual({ version: 2, status: "draft", summary: "Answer leads fast" });
    const l = (await q(`select l.title, l.minutes, l.objectives, l.content -> 'keyClaims' as claims from public.lessons l
      join public.modules m on m.id = l.module_id where m.course_id = $1`, [created])).rows;
    expect(l).toEqual([{ title: "Why minutes matter", minutes: 12, objectives: ["Explain the drop-off"], claims: plan.modules[0].lessons[0].keyClaims }]);
    expect((await q("select key from public.skills where course_id = $1", [created])).rows).toEqual([{ key: "response" }]);
    expect((await q("select status, course_id from public.academy_blueprints where id = $1", [bp])).rows[0]).toEqual({ status: "approved", course_id: created });
    await expect(q("select public.approve_course_blueprint($1, $2)", [bp, owner])).rejects.toThrow(/already approved/);
    // A cited source that's no longer approved stops the approval, and nothing is created.
    const bp2 = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan)
      values ($1, $2, 'course', 'Lead response', 'beginner', $3) returning id`, [owner, academy, JSON.stringify(plan)])).rows[0].id;
    await q("update public.sources set status = 'rejected' where id = $1", [source]);
    await expect(q("select public.approve_course_blueprint($1, $2)", [bp2, owner])).rejects.toThrow(/no longer approved/);
    await q("update public.sources set status = 'approved' where id = $1", [source]);
    expect((await q("select count(*)::int as n from public.courses where academy_id = $1", [academy])).rows[0].n).toBe(2);
    expect((await q("select has_function_privilege('authenticated', 'public.approve_course_blueprint(uuid, uuid)', 'execute') as x")).rows[0].x).toBe(false);
  });

  it("a lesson version starts as the next Draft; only a Draft can be changed; versions are never deleted", async () => {
    await expect(draft(2)).rejects.toThrow(/next version of this lesson is 1/);
    await expect(q(`insert into public.lesson_versions (lesson_id, course_id, version, status, title, body, created_by_account_id, submitted_at, submitted_by_account_id)
      values ($1, $2, 1, 'review', 't', '{}', $3, now(), $3)`, [lesson, course, owner])).rejects.toThrow(/starts as a Draft/);
    const v1 = (await draft(1, [{ ref: 1, sourceId: source }])).rows[0].id;
    await expect(draft(2)).rejects.toThrow(/lesson_versions_one_open/);
    await set(v1, "title = 'Respond fast'");
    await set(v1, "status = 'review', submitted_at = now(), submitted_by_account_id = $2", [owner]);
    await expect(set(v1, "title = 'Changed in review'")).rejects.toThrow(/only a Draft can be changed/);
    await expect(q("delete from public.lesson_versions where id = $1", [v1])).rejects.toThrow(/kept/);
  });

  it("publishing needs a Reviewer's verification and approved sources; it archives the old version and puts the course live", async () => {
    const v1 = (await q("select id from public.lesson_versions where lesson_id = $1 and version = 1", [lesson])).rows[0].id;
    await expect(set(v1, "status = 'published', published_at = now(), published_by_account_id = $2", [owner])).rejects.toThrow(/lesson_versions_verified|only after a Reviewer verifies/);
    await expect(set(v1, "verified_at = now(), verified_by_account_id = $2", [learner])).rejects.toThrow(/only the Owner or a Reviewer/);
    await set(v1, "verified_at = now(), verified_by_account_id = $2, verification_note = 'Citations checked'", [reviewer]);
    await q("update public.sources set status = 'rejected' where id = $1", [source]);
    await expect(set(v1, "status = 'published', published_at = now(), published_by_account_id = $2", [owner])).rejects.toThrow(/no longer approved/);
    await q("update public.sources set status = 'approved' where id = $1", [source]);
    await set(v1, "status = 'published', published_at = now(), published_by_account_id = $2", [owner]);
    expect((await q("select status from public.courses where id = $1", [course])).rows[0].status).toBe("published");
    await expect(set(v1, "status = 'draft'")).rejects.toThrow(/isn't allowed/);

    const v2 = (await draft(2, [{ ref: 1, sourceId: source }])).rows[0].id;
    await set(v2, "status = 'review', submitted_at = now(), submitted_by_account_id = $2", [owner]);
    await set(v2, "verified_at = now(), verified_by_account_id = $2", [reviewer]);
    // Returned to Draft: the verification is cleared and must be given again.
    await set(v2, "status = 'draft', returned_note = 'Tighten section 2'");
    expect((await q("select verified_by_account_id, submitted_at from public.lesson_versions where id = $1", [v2])).rows[0]).toEqual({ verified_by_account_id: null, submitted_at: null });
    await set(v2, "status = 'review', submitted_at = now(), submitted_by_account_id = $2", [owner]);
    await set(v2, "verified_at = now(), verified_by_account_id = $2", [owner]);
    await set(v2, "status = 'published', published_at = now(), published_by_account_id = $2", [owner]);
    expect([await status(v1), await status(v2)]).toEqual(["archived", "published"]);
  });

  it("learner progress points to a published version of the same lesson", async () => {
    const mod = (await q("select module_id from public.lessons where id = $1", [lesson])).rows[0].module_id;
    const [v1, v2] = (await q("select id from public.lesson_versions where lesson_id = $1 order by version", [lesson])).rows.map((r) => r.id);
    const progress = (v: string) => q(`insert into public.progress_records (account_id, module_id, lesson_id, lesson_version_id, status)
      values ($1, $2, $3, $4, 'complete') returning id`, [learner, mod, lesson, v]);
    await expect(progress(v1)).rejects.toThrow(/only on a published lesson version/);
    await expect(progress(v2)).resolves.toBeDefined();
    await expect(progress(v2)).rejects.toThrow(/progress_records_one_per_version/);
  });

  it("keeps the new tables away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.lesson_versions', 'select') as l,
      has_table_privilege('anon', 'public.research_runs', 'select') as r`);
    expect(rows[0]).toEqual({ l: false, r: false });
  });

  it("refuses L2 on a database without L1", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0012")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L2.sql"))).rejects.toThrow(/apply L1 \(0012\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
