import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, asRole, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";
import { checkImport, type ImportContext, type TrackPlan } from "@/lib/courses/import-format";
import { sampleTrack } from "../fixtures/course-import";

/**
 * S1 (0023): skill tracks, applied as the SQL Editor bundle to a live I1 database. public.import_track makes a new Draft
 * version holding the file's Rounds plus the stored Rounds it doesn't replace (copied, never moved); Round r needs Round
 * r-1 in the file or stored; a published version is never touched; a failure part-way leaves nothing; only the Owner,
 * and only the server. new_course_version carries the track flag and each section's Round, and the C2 label rules
 * apply to tracks. Test-only data.
 */
describe("the S1 bundle on the live I1 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner = "", admin = "";
  let stored: ImportContext["track"] = null;
  const planFor = (rounds: number[], slug = "copywriting"): TrackPlan => {
    const r = checkImport(JSON.stringify(sampleTrack(slug, rounds)), {
      topic: { slug, name: "Copywriting", kind: "skill", teenHidden: false, published: false, draftVersions: 0 },
      skillSlugs: new Set(), boosters: [], today: "2026-10-10", track: stored,
    });
    if (!r.plan) throw new Error(JSON.stringify(r.problems));
    return r.plan as TrackPlan;
  };
  const run = (plan: unknown, actor = owner) => q("select public.import_track($1, $2) as r", [actor, JSON.stringify(plan)]);
  const counts = async () => (await q(`select (select count(*) from public.courses)::int as courses, (select count(*) from public.modules)::int as modules,
    (select count(*) from public.lesson_versions)::int as versions, (select count(*) from public.activity_items)::int as items, (select count(*) from public.sources)::int as sources,
    (select count(*) from public.academy_blueprints)::int as blueprints`)).rows[0];
  const versions = async () => (await q(`select c.version, c.status, c.is_track, c.size_tier, array_agg(m.round order by m.position) as rounds, array_agg(m.code order by m.position) as codes
    from public.courses c join public.academies a on a.id = c.academy_id left join public.modules m on m.course_id = c.id
    where a.slug = 'copywriting' group by c.id order by c.version`)).rows;
  const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0023")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    owner = await acc("user_owner", "owner");
    admin = await acc("user_admin", "admin");
    await q(readSql("db/apply/S1.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql reports S1 applied", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^OK: .*S1 skill tracks are in place$/);
  });

  it("a course can't be both a track and sized", async () => {
    await expect(q("insert into public.academies (slug, name) values ('t-x', 'T'); insert into public.courses (academy_id, version, is_track, size_tier) select id, 1, true, 'compact' from public.academies where slug = 't-x'"))
      .rejects.toThrow(/courses_track_no_tier/);
  });

  it("Round 1 alone: a Draft track of 5 sections, no size tier, nothing approved", async () => {
    const r = (await run(planFor([1]))).rows[0].r;
    expect(r).toMatchObject({ version: 1, academySlug: "copywriting", rounds: [1], carriedRounds: [], counts: { sections: 5, lessons: 5, items: 20, carriedSections: 0, newSources: 1 } });
    expect(await versions()).toEqual([{ version: 1, status: "draft", is_track: true, size_tier: null, rounds: [1, 1, 1, 1, 1], codes: ["r1s1", "r1s2", "r1s3", "r1s4", "r1s5"] }]);
    expect((await q("select distinct status, recipe_part from public.activity_items where course_id = $1 and item_type = 'mini_project'", [r.courseId])).rows).toEqual([{ status: "draft", recipe_part: "assignment" }]);
    expect((await q("select status, approved_by_account_id, plan->'rounds'->0->>'label' as label from public.academy_blueprints where id = $1", [r.blueprintId])).rows[0])
      .toEqual({ status: "approved", approved_by_account_id: owner, label: "Round 1: test practice" });
    expect((await q("select count(*)::int as n from public.module_reviews")).rows[0].n).toBe(0);
  });

  it("Round 3 can't come before Round 2 exists, and nothing is created", async () => {
    stored = { rounds: [1], meta: [] };
    const before = await counts();
    const plan = planFor([2]);
    plan.modules = plan.modules.map((m) => ({ ...m, round: 3, position: m.position + 5 }));
    plan.rounds = [{ ...plan.rounds[0], roundNumber: 3 }];
    await expect(run(plan)).rejects.toThrow(/Round 3 can't be added before Round 2 exists/);
    expect(await counts()).toEqual(before);
  });

  it("Round 2 on its own: a new Draft version carrying the stored Round 1, which stays as it was", async () => {
    const r = (await run(planFor([2]))).rows[0].r;
    expect(r).toMatchObject({ version: 2, rounds: [2], carriedRounds: [1], counts: { sections: 5, carriedSections: 5, newSources: 0 } });
    const v = await versions();
    expect(v[0].rounds).toEqual([1, 1, 1, 1, 1]);
    expect(v[1]).toMatchObject({ version: 2, status: "draft", is_track: true, rounds: [1, 1, 1, 1, 1, 2, 2, 2, 2, 2], codes: ["r1s1", "r1s2", "r1s3", "r1s4", "r1s5", "r2s1", "r2s2", "r2s3", "r2s4", "r2s5"] });
    // The carried Round 1 came from a Draft, so its draft items and lessons were copied as Drafts.
    expect((await q("select count(*)::int as n from public.activity_items where course_id = $1", [r.courseId])).rows[0].n).toBe(40);
    expect((await q("select distinct status from public.lesson_versions where course_id = $1", [r.courseId])).rows).toEqual([{ status: "draft" }]);
  });

  it("a published version is never touched: Round 3 makes a new Draft and the published one keeps every row", async () => {
    await q("update public.courses set status = 'published', published_at = now() where version = 2 and academy_id = (select id from public.academies where slug = 'copywriting')");
    const pub = (await q("select id from public.courses where version = 2 and academy_id = (select id from public.academies where slug = 'copywriting')")).rows[0].id;
    const snap = async () => (await q("select (select count(*) from public.modules where course_id = $1)::int as m, (select count(*) from public.activity_items where course_id = $1)::int as i, (select count(*) from public.lesson_versions where course_id = $1)::int as l, (select status from public.courses where id = $1) as s", [pub])).rows[0];
    const before = await snap();
    stored = { rounds: [1, 2], meta: [] };
    const r = (await run(planFor([3]))).rows[0].r;
    expect(r).toMatchObject({ version: 3, rounds: [3], carriedRounds: [1, 2], counts: { sections: 5, carriedSections: 10 } });
    expect(await snap()).toEqual(before);
    expect((await versions())[2]).toMatchObject({ version: 3, status: "draft", rounds: [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3] });
  });

  it("new_course_version carries the track flag and each section's Round", async () => {
    await q("update public.courses set status = 'published', published_at = now() where version = 3 and academy_id = (select id from public.academies where slug = 'copywriting')");
    const id = (await q("select public.new_course_version((select id from public.academies where slug = 'copywriting'), $1) as id", [owner])).rows[0].id;
    expect((await q("select is_track, size_tier from public.courses where id = $1", [id])).rows[0]).toEqual({ is_track: true, size_tier: null });
    expect((await q("select array_agg(round order by position) as r from public.modules where course_id = $1", [id])).rows[0].r).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  });

  it("the C2 label rules apply to tracks: an unlabelled item can't be approved", async () => {
    const it = (await q(`select i.id from public.activity_items i join public.courses c on c.id = i.course_id where c.is_track and c.status = 'draft' limit 1`)).rows[0].id;
    await q("update public.activity_items set importance = null where id = $1", [it]);
    await expect(q("update public.activity_items set status = 'approved' where id = $1", [it])).rejects.toThrow(/label this item/);
    // A section's Round is 1 to 3.
    await expect(q("update public.modules set round = 4 where id = (select id from public.modules where round is not null limit 1)")).rejects.toThrow(/check constraint/);
  });

  it("a failure part-way rolls everything back: nothing is left behind", async () => {
    stored = null;
    const before = await counts();
    const plan = planFor([1], "copywriting");
    (plan.modules[4].items[0] as { itemType: string }).itemType = "not_a_type";
    await expect(run(plan)).rejects.toThrow(/activity_items_item_type_check|violates check constraint/);
    expect(await counts()).toEqual(before);
  });

  it("refuses a business or side hustle, a Round that isn't 5 sections, an unknown topic", async () => {
    await expect(run({ ...planFor([1]), topicSlug: "graphic-design" })).rejects.toThrow(/is a business; a track \(format 2\) is for skills only/);
    const short = planFor([1]);
    short.modules = short.modules.slice(0, 4);
    await expect(run(short)).rejects.toThrow(/Round 1 has 4 sections; a Round has 5/);
    await expect(run({ ...planFor([1]), topicSlug: "no-such-topic" })).rejects.toThrow(/unknown topic/);
  });

  it("only the Owner, and only the server", async () => {
    await expect(run(planFor([1]), admin)).rejects.toThrow(/only the Owner imports a course/);
    for (const role of ["anon", "authenticated"] as const) {
      const r = await asRole(db.client, role, null, "select public.import_track($1, $2)", [owner, JSON.stringify(planFor([1]))]);
      expect(r.error).toMatch(/permission denied/);
    }
  });
});
