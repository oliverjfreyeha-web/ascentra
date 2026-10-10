import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, asRole, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";
import { checkImport, type ImportPlan } from "@/lib/courses/import-format";
import { sampleCourse } from "../fixtures/course-import";

/**
 * I1 (0022): public.import_course, applied as the SQL Editor bundle to a live C2 database. One transaction: a new Draft
 * course version with modules, Draft lesson versions, Draft labelled practice items, video slots waiting for video,
 * sources in the library as "proposed", the capstone and the notices, and the import record (an approved, person-made
 * course Blueprint). A second import makes the next Draft version and leaves the first; a published course is refused;
 * a failure part-way leaves nothing behind; only the Owner, and only the server, can run it. Test-only data.
 */
describe("the I1 bundle on the live C2 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner = "", admin = "";
  const planFor = (doc: unknown = sampleCourse()): ImportPlan => {
    const r = checkImport(JSON.stringify(doc), { topic: { slug: "graphic-design", name: "Freelance graphic design", kind: "business", teenHidden: false, published: false, draftVersions: 0 },
      skillSlugs: new Set(), boosters: [], today: "2026-10-10" });
    if (!r.plan) throw new Error(JSON.stringify(r.problems));
    return r.plan;
  };
  const run = (plan: unknown, actor = owner) => q("select public.import_course($1, $2) as r", [actor, JSON.stringify(plan)]);
  const counts = async () => (await q(`select (select count(*) from public.courses)::int as courses, (select count(*) from public.modules)::int as modules,
    (select count(*) from public.lesson_versions)::int as versions, (select count(*) from public.activity_items)::int as items, (select count(*) from public.video_slots)::int as slots,
    (select count(*) from public.sources)::int as sources, (select count(*) from public.academy_blueprints)::int as blueprints, (select count(*) from public.course_capstones)::int as capstones`)).rows[0];
  const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0022")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    owner = await acc("user_owner", "owner");
    admin = await acc("user_admin", "admin");
    await q(readSql("db/apply/I1.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql is OK", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^OK: all 82 tables.*C2 progress, side hustles and unlock rules are in place; I1 course import is in place$/);
  });

  it("creates the Draft course and everything in it, in the existing tables, publishing and approving nothing", async () => {
    const r = (await run(planFor())).rows[0].r;
    expect(r).toMatchObject({ version: 1, academySlug: "graphic-design", counts: { modules: 3, lessons: 3, videoSlots: 3, items: 12, sources: 1, newSources: 1 } });
    expect((await q("select status, owner_review_required, size_tier, software_notice, license_notice from public.courses where id = $1", [r.courseId])).rows[0])
      .toEqual({ status: "draft", owner_review_required: true, size_tier: "compact", software_notice: expect.stringMatching(/^Test notice/), license_notice: null });
    expect((await q("select distinct status, generated_by from public.lesson_versions where course_id = $1", [r.courseId])).rows).toEqual([{ status: "draft", generated_by: "person" }]);
    const items = (await q("select item_type, status, recipe_part, importance, notebook_note is not null as note, citation->>'sourceId' as src from public.activity_items where course_id = $1 order by item_type", [r.courseId])).rows;
    expect(new Set(items.map((i) => i.status))).toEqual(new Set(["draft"]));
    expect(items.filter((i) => i.item_type === "multiple_choice").every((i) => i.importance === "very_important" && i.note)).toBe(true);
    const src = (await q("select id, status, academy_id, license_class, url from public.sources")).rows;
    expect(src).toEqual([{ id: items[0].src, status: "proposed", academy_id: null, license_class: "web_summarize_only", url: "https://example.org/test-design-basics" }]);
    expect((await q("select distinct s.status, s.importance from public.video_slots s join public.modules m on m.id = s.module_id where m.course_id = $1", [r.courseId])).rows).toEqual([{ status: "waiting", importance: "important" }]);
    const cites = (await q("select citations from public.lesson_versions where course_id = $1 limit 1", [r.courseId])).rows[0].citations;
    expect(cites).toEqual([expect.objectContaining({ ref: 1, sourceId: src[0].id })]);
    expect((await q("select title, automation->'plans' as plans from public.course_capstones where course_id = $1", [r.courseId])).rows[0]).toEqual({ title: "Test capstone: a practice flyer", plans: [] });
    const bp = (await q("select status, kind, generated_by, approved_by_account_id, course_id, plan->'imported'->'resources' as resources from public.academy_blueprints where id = $1", [r.blueprintId])).rows[0];
    expect(bp).toMatchObject({ status: "approved", kind: "course", generated_by: "person", approved_by_account_id: owner, course_id: r.courseId });
    expect(bp.resources).toHaveLength(2);
    // The topic is linked to the catalog; its cost, outlook and teen settings are untouched.
    expect((await q("select catalog_slug, cost_low, outlook_label, teen_hidden from public.topics where slug = 'graphic-design'")).rows[0]).toEqual({ catalog_slug: "graphic-design", cost_low: null, outlook_label: null, teen_hidden: false });
    // Nothing was approved or published.
    expect((await q("select count(*)::int as n from public.module_reviews")).rows[0].n).toBe(0);
  });

  it("a second import makes the next Draft version and leaves the first; the source is reused", async () => {
    const before = await counts();
    const r = (await run(planFor())).rows[0].r;
    expect(r).toMatchObject({ version: 2, counts: { newSources: 0 } });
    expect((await q("select version, status from public.courses c join public.academies a on a.id = c.academy_id where a.slug = 'graphic-design' order by version")).rows)
      .toEqual([{ version: 1, status: "draft" }, { version: 2, status: "draft" }]);
    expect((await counts()).sources).toBe(before.sources);
  });

  it("a failure part-way rolls everything back: nothing is left behind", async () => {
    const before = await counts();
    const plan = planFor(sampleCourse("seo-services"));
    (plan.modules[2].items[0] as { itemType: string }).itemType = "not_a_type";
    await expect(run(plan)).rejects.toThrow(/activity_items_item_type_check|violates check constraint/);
    expect(await counts()).toEqual(before);
    expect((await q("select catalog_slug from public.topics where slug = 'seo-services'")).rows[0].catalog_slug).toBeNull();
  });

  it("refuses a topic whose course has been published, leaving the published version alone", async () => {
    await q("update public.courses set status = 'published', published_at = now() where version = 1 and academy_id = (select id from public.academies where slug = 'graphic-design')");
    const before = await counts();
    await expect(run(planFor())).rejects.toThrow(/already has a published course/);
    expect(await counts()).toEqual(before);
  });

  it("refuses an unknown topic, a module count outside the tier, a citation to a missing source", async () => {
    await expect(run({ ...planFor(sampleCourse("seo-services")), topicSlug: "no-such-topic" })).rejects.toThrow(/unknown topic/);
    const short = planFor(sampleCourse("seo-services"));
    short.modules = short.modules.slice(0, 2);
    await expect(run(short)).rejects.toThrow(/Compact course has 3 to 4 modules/);
    const missing = planFor(sampleCourse("seo-services"));
    (missing.modules[0].items[0] as { citation: unknown }).citation = { sourceId: "@@src:gone@@", title: "x" };
    await expect(run(missing)).rejects.toThrow(/cites a source that isn't in its sources list/);
  });

  it("only the Owner, and only the server", async () => {
    await expect(run(planFor(sampleCourse("seo-services")), admin)).rejects.toThrow(/only the Owner imports a course/);
    for (const role of ["anon", "authenticated"] as const) {
      const r = await asRole(db.client, role, null, "select public.import_course($1, $2)", [owner, JSON.stringify(planFor(sampleCourse("seo-services")))]);
      expect(r.error).toMatch(/permission denied/);
    }
  });
});
