import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, asRole, clerkClaims, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/**
 * C1 (0020): course structure v2, video slots and the Owner's review, held by the database, applied as the SQL Editor
 * bundle to a live L8 database. Test-only data: made-up titles and an example.org source, never reaching production.
 */
describe("the C1 bundle on the live L8 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string, reviewer: string, learner: string, source: string, academy: string;

  const lesson = (n: number, mi: number) => ({ title: `Test lesson ${mi}.${n}`, minutes: 10, objectives: ["Test objective"], keyClaims: [{ claim: "Test claim.", sourceId: source }] });
  const moduleOf = (mi: number, videos = 1) => ({
    title: `Test module ${mi}`, stage: mi < 3 ? "Foundations" : "Application", lessons: [lesson(1, mi), lesson(2, mi)], skills: [{ key: `skill-${mi}`, name: `Skill ${mi}` }],
    recipe: { videos, quizzes: 2, assignments: 1, sandboxes: 1, sequences: 1, boosters: ["teach-it-back"] },
    videos: Array.from({ length: videos }, (_, i) => ({ title: `Test video ${mi}.${i + 1}`, brief: { purpose: "Test purpose", points: [{ text: "Test point", sources: [{ sourceId: source, title: "Test study" }] }], targetMinutes: 6 } })),
  });
  const blueprint = async (modules: number, structure = 2) => (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by)
    values ($1, $2, 'course', 'Test topic', 'beginner', $3, 'ai') returning id`,
  [owner, academy, JSON.stringify({ structure, title: "Test course", outcome: "Test outcome", modules: Array.from({ length: modules }, (_, i) => moduleOf(i + 1, (i % 2) + 1)) })])).rows[0].id as string;
  const approve = async (bp: string) => (await q("select public.approve_course_blueprint($1, $2) as id", [bp, owner])).rows[0].id as string;
  const modulesOf = async (course: string) => (await q("select id, position, recipe from public.modules where course_id = $1 order by position", [course])).rows as { id: string; position: number; recipe: Record<string, unknown> }[];
  const lessonsOf = async (mod: string) => (await q("select id from public.lessons where module_id = $1 order by position", [mod])).rows.map((r) => r.id as string);
  /** One Reviewer-verified version per lesson of a module (reusing an open one, else drafting a new one); returns the ids. */
  const verifiedVersions = async (course: string, mod: string) => {
    const ids: string[] = [];
    for (const l of await lessonsOf(mod)) {
      const open = (await q("select id, status, verified_by_account_id from public.lesson_versions where lesson_id = $1 and status in ('draft', 'review')", [l])).rows[0] as
        { id: string; status: string; verified_by_account_id: string | null } | undefined;
      const next = (await q("select coalesce(max(version), 0) + 1 as n from public.lesson_versions where lesson_id = $1", [l])).rows[0].n;
      const v = open?.id ?? (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, created_by_account_id)
        values ($1, $2, $3, 'Test', '{"sections": []}', $4::jsonb, $5) returning id`, [l, course, next, JSON.stringify([{ ref: 1, sourceId: source }]), owner])).rows[0].id as string;
      if (!open || open.status === "draft") await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v, owner]);
      if (!open?.verified_by_account_id) await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2, verification_note = 'Checked' where id = $1", [v, reviewer]);
      ids.push(v);
    }
    return ids;
  };
  const review = (course: string, mod: string, decision: string, versions: string[], by = owner, note: string | null = null, items: string[] = []) =>
    q(`insert into public.module_reviews (module_id, course_id, decision, note, lesson_version_ids, item_ids, decided_by_account_id) values ($1, $2, $3, $4, $5, $6, $7)`,
      [mod, course, decision, note, versions, items, by]);
  const publish = (v: string) => q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [v, owner]);

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0020")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
    owner = await acc("user_owner", "owner");
    reviewer = await acc("user_reviewer", "admin");
    learner = await acc("user_learner", "learner");
    source = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
      values ('Test study', 'web', 'https://example.org/test', 'approved', $1, now()) returning id`, [reviewer])).rows[0].id;
    academy = (await q("insert into public.academies (slug, name) values ('test-course', 'Test course') returning id")).rows[0].id;
    await q(readSql("db/apply/C1.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql is OK with 73 tables", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^OK: all 73 tables.*C1 course structure and Owner review are in place$/);
  });

  it("seeds the seven learning boosters, each carried by existing activity types", async () => {
    const { rows } = await q("select key, item_types from public.booster_types order by sort_order");
    expect(rows.map((r) => r.key)).toEqual(["real-world-teardown", "common-mistakes-hunt", "checklist-or-template", "tool-shortlist", "role-play-scenario", "teach-it-back", "weekly-reflection"]);
    await expect(q("insert into public.booster_types (key, name, item_types) values ('made-up', 'Made up', array['new_type'])")).rejects.toThrow(/check/);
  });

  it("a v2 Blueprint needs 5 or 6 modules; approving it stores each recipe, the video slots and briefs, and requires the Owner's review", async () => {
    await expect(approve(await blueprint(4))).rejects.toThrow(/5 or 6 modules/);
    const course = await approve(await blueprint(5));
    expect((await q("select owner_review_required from public.courses where id = $1", [course])).rows[0].owner_review_required).toBe(true);
    const mods = await modulesOf(course);
    expect(mods).toHaveLength(5);
    expect(mods[0].recipe).toMatchObject({ quizzes: 2, boosters: ["teach-it-back"] });
    const slots = (await q(`select s.title, s.status, s.brief -> 'points' -> 0 ->> 'text' as point, s.brief_generated_by from public.video_slots s
      join public.modules m on m.id = s.module_id where m.course_id = $1 order by m.position, s.position`, [course])).rows;
    expect(slots).toHaveLength(1 + 2 + 1 + 2 + 1);
    expect(slots[0]).toEqual({ title: "Test video 1.1", status: "waiting", point: "Test point", brief_generated_by: "ai" });
    // A 6-module course too; an L2 (v1) Blueprint keeps the old rules.
    expect(await modulesOf(await approve(await blueprint(6)))).toHaveLength(6);
    const v1 = await approve(await blueprint(2, 1));
    expect((await q("select owner_review_required from public.courses where id = $1", [v1])).rows[0].owner_review_required).toBe(false);
    expect((await q("select count(*)::int as n from public.video_slots s join public.modules m on m.id = s.module_id where m.course_id = $1", [v1])).rows[0].n).toBe(0);
  });

  describe("the Owner's review", () => {
    let course: string;
    let mods: { id: string }[];
    beforeAll(async () => {
      course = await approve(await blueprint(5));
      mods = await modulesOf(course);
    });

    it("only the Owner decides; a send-back needs a note and returns the module's versions in Review to Draft with it", async () => {
      const vs = await verifiedVersions(course, mods[0].id);
      await expect(review(course, mods[0].id, "approved", vs, reviewer)).rejects.toThrow(/only the Owner reviews/);
      await expect(review(course, mods[0].id, "sent_back", [], owner, "")).rejects.toThrow(/check/);
      await review(course, mods[0].id, "sent_back", [], owner, "Test: tighten the second lesson");
      const after = (await q("select status, returned_note, verified_by_account_id from public.lesson_versions where id = any($1)", [vs])).rows;
      expect(after.every((r) => r.status === "draft" && r.returned_note === "Sent back by the Owner: Test: tighten the second lesson" && r.verified_by_account_id === null)).toBe(true);
    });

    it("approval covers one Reviewer-verified version of every lesson in the module", async () => {
      const vs = await verifiedVersions(course, mods[1].id);
      await expect(review(course, mods[1].id, "approved", [vs[0]])).rejects.toThrow(/every lesson/);
      await q("update public.lesson_versions set status = 'draft' where id = $1", [vs[1]]);
      await expect(review(course, mods[1].id, "approved", vs)).rejects.toThrow(/Reviewer-verified or published/);
      // Another module's version doesn't count.
      const other = await verifiedVersions(course, mods[2].id);
      await expect(review(course, mods[1].id, "approved", [vs[0], other[0]])).rejects.toThrow(/Reviewer-verified or published|every lesson/);
    });

    it("nothing publishes without the Owner's approval; the course's first publication needs every module approved", async () => {
      const vs = await verifiedVersions(course, mods[3].id);
      await expect(publish(vs[0])).rejects.toThrow(/Owner approves this module/);
      await review(course, mods[3].id, "approved", vs);
      // Other modules aren't approved yet: the course can't go live.
      await expect(publish(vs[0])).rejects.toThrow(/every module/);
      for (const m of mods) {
        if (m.id === mods[3].id) continue;
        await review(course, m.id, "approved", await verifiedVersions(course, m.id));
      }
      await publish(vs[0]);
      expect((await q("select status from public.courses where id = $1", [course])).rows[0].status).toBe("published");
    });

    it("an approval made before a version was resubmitted no longer counts; a new version needs approving again", async () => {
      const vs = (await q(`select v.id, v.lesson_id from public.lesson_versions v join public.lessons l on l.id = v.lesson_id
        where l.module_id = $1 and v.status = 'review' order by l.position`, [mods[3].id])).rows;
      // Back to Draft and resubmitted after the approval: stale.
      await q("update public.lesson_versions set status = 'draft' where id = $1", [vs[0].id]);
      await q("update public.lesson_versions set status = 'review', submitted_at = now() + interval '1 second', submitted_by_account_id = $2 where id = $1", [vs[0].id, owner]);
      await q("update public.lesson_versions set verified_at = now() + interval '1 second', verified_by_account_id = $2 where id = $1", [vs[0].id, reviewer]);
      await expect(publish(vs[0].id)).rejects.toThrow(/Owner approves this module/);
      // A refresh-style new version of a published lesson needs its own approval.
      const pub = (await q(`select v.lesson_id, v.version from public.lesson_versions v join public.lessons l on l.id = v.lesson_id where l.module_id = $1 and v.status = 'published'`, [mods[3].id])).rows[0];
      expect(pub).toBeTruthy();
      const nv = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, created_by_account_id)
        values ($1, $2, $3, 'Test v2', '{"sections": []}', $4::jsonb, $5) returning id`, [pub.lesson_id, course, pub.version + 1, JSON.stringify([{ ref: 1, sourceId: source }]), owner])).rows[0].id;
      await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [nv, owner]);
      await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2 where id = $1", [nv, reviewer]);
      await expect(publish(nv)).rejects.toThrow(/Owner approves this module/);
    });

    it("decisions are insert-only, for the API's service role too", async () => {
      await expect(q("update public.module_reviews set decision = 'approved'")).rejects.toThrow(/insert-only/);
      await expect(q("delete from public.module_reviews")).rejects.toThrow(/insert-only/);
      expect((await asRole(db.client, "service_role", null, "update public.module_reviews set note = 'x'")).error).toMatch(/permission denied/);
    });

    it("activity items publish only when the Owner's approval lists them", async () => {
      const mod = mods[4].id;
      const l = (await lessonsOf(mod))[0];
      const item = (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, explanation, citation, recipe_part)
        values ($1, $2, $3, 'test-idea', 'teach_back', 'feedback', 'beginner', 'Test goal', 'Test prompt', 'Test explanation', $4, 'booster') returning id`,
      [l, mod, course, JSON.stringify({ sourceId: source })]).catch((e) => e)) as Error;
      expect(item.message).toMatch(/activity_items_booster/);
      const id = (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, explanation, citation, recipe_part, booster_key)
        values ($1, $2, $3, 'test-idea', 'teach_back', 'feedback', 'beginner', 'Test goal', 'Test prompt', 'Test explanation', $4, 'booster', 'teach-it-back') returning id`,
      [l, mod, course, JSON.stringify({ sourceId: source })])).rows[0].id;
      await q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now() where id = $1", [id, reviewer]);
      await expect(q("update public.activity_items set recipe_part = 'assignment', booster_key = null where id = $1", [id])).rejects.toThrow(/only a Draft activity item changes its recipe part/);
      await expect(q("update public.activity_items set status = 'published', published_at = now() where id = $1", [id])).rejects.toThrow(/Owner approves this module/);
      await review(course, mod, "approved", await verifiedVersions(course, mod), owner, null, [id]);
      await q("update public.activity_items set status = 'published', published_at = now() where id = $1", [id]);
    });
  });

  describe("video slots", () => {
    let slot: string;
    beforeAll(async () => {
      const course = await approve(await blueprint(5));
      slot = (await q("select s.id from public.video_slots s join public.modules m on m.id = s.module_id where m.course_id = $1 order by m.position, s.position limit 1", [course])).rows[0].id;
    });
    const upload = (path: string) => q(`insert into public.video_uploads (slot_id, storage_path, mime, size_bytes, uploaded_by_account_id) values ($1, $2, 'video/mp4', 1000, $3) returning id`, [slot, path, owner]);
    const p = (n: number) => `${"0".repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}/${"1".repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}.mp4`;

    it("an accepted upload shows in the slot; the Owner alone approves it, and only with a transcript", async () => {
      const u = (await upload(p(1))).rows[0].id;
      await expect(q("update public.video_slots set current_upload_id = $2, status = 'uploaded' where id = $1", [slot, u])).rejects.toThrow(/accepted upload/);
      expect((await q("select public.accept_video_upload($1) as prev", [u])).rows[0].prev).toBeNull();
      expect((await q("select status, current_upload_id from public.video_slots where id = $1", [slot])).rows[0]).toEqual({ status: "uploaded", current_upload_id: u });
      await expect(q("update public.video_slots set status = 'approved', approved_at = now(), approved_by_account_id = $2 where id = $1", [slot, owner])).rejects.toThrow(/video_slots_transcript/);
      await q("update public.video_slots set transcript = 'Test transcript: what the video says, in words.' where id = $1", [slot]);
      await expect(q("update public.video_slots set status = 'approved', approved_at = now(), approved_by_account_id = $2 where id = $1", [slot, reviewer])).rejects.toThrow(/only the Owner approves a video/);
      await q("update public.video_slots set status = 'approved', approved_at = now(), approved_by_account_id = $2 where id = $1", [slot, owner]);
    });

    it("replacing the video keeps the old upload record (replaced) and needs approving again; records are never deleted", async () => {
      const first = (await q("select current_upload_id from public.video_slots where id = $1", [slot])).rows[0].current_upload_id;
      const u2 = (await upload(p(2))).rows[0].id;
      expect((await q("select public.accept_video_upload($1) as prev", [u2])).rows[0].prev).toBe(first);
      expect((await q("select status from public.video_uploads where id = $1", [first])).rows[0].status).toBe("replaced");
      expect((await q("select status, approved_at from public.video_slots where id = $1", [slot])).rows[0]).toEqual({ status: "uploaded", approved_at: null });
      await expect(q("delete from public.video_uploads where id = $1", [first])).rejects.toThrow(/kept for the audit trail/);
      await expect(q("update public.video_uploads set storage_path = $2 where id = $1", [first, p(9)])).rejects.toThrow(/keeps what was uploaded/);
      await expect(q("update public.video_uploads set status = 'accepted' where id = $1", [first])).rejects.toThrow(/pending -> accepted/);
      expect((await asRole(db.client, "service_role", null, "delete from public.video_uploads")).error).toMatch(/permission denied/);
    });
  });

  it("a new course version copies the structure as Drafts that need review and the Owner's approval again; refused while a Draft exists", async () => {
    await expect(q("select public.new_course_version($1, $2)", [academy, owner])).rejects.toThrow(/still a Draft/);
    const other = (await q("insert into public.academies (slug, name) values ('test-copy', 'Test copy') returning id")).rows[0].id;
    const bp = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by)
      values ($1, $2, 'course', 'Test', 'beginner', $3, 'ai') returning id`, [owner, other, JSON.stringify({ structure: 2, title: "T", outcome: "O", modules: [1, 2, 3, 4, 5].map((i) => moduleOf(i)) })])).rows[0].id;
    const c1 = await approve(bp);
    const mods = await modulesOf(c1);
    for (const m of mods) await review(c1, m.id, "approved", await verifiedVersions(c1, m.id));
    for (const m of mods) for (const v of (await q(`select v.id from public.lesson_versions v join public.lessons l on l.id = v.lesson_id where l.module_id = $1 and v.status = 'review'`, [m.id])).rows) await publish(v.id);
    await expect(q("select public.new_course_version($1, $2)", [other, learner])).rejects.toThrow(/Owner or a course builder/);
    const c2 = (await q("select public.new_course_version($1, $2) as id", [other, owner])).rows[0].id;
    expect((await q("select version, status, owner_review_required from public.courses where id = $1", [c2])).rows[0]).toEqual({ version: 2, status: "draft", owner_review_required: true });
    expect(await modulesOf(c2)).toHaveLength(5);
    const versions = (await q("select v.status, v.version from public.lesson_versions v where v.course_id = $1", [c2])).rows;
    expect(versions).toHaveLength(10);
    expect(versions.every((v) => v.status === "draft" && v.version === 1)).toBe(true);
    expect((await q("select count(*)::int as n from public.video_slots s join public.modules m on m.id = s.module_id where m.course_id = $1", [c2])).rows[0].n).toBe(5);
    // Reordering works on the Draft, never on the published version.
    const ids = (await modulesOf(c2)).map((m) => m.id);
    await q("select public.reorder_modules($1, $2)", [c2, [...ids].reverse()]);
    expect((await modulesOf(c2)).map((m) => m.id)).toEqual([...ids].reverse());
    await expect(q("select public.reorder_modules($1, $2)", [c1, (await modulesOf(c1)).map((m) => m.id)])).rejects.toThrow(/only a Draft course version is reordered/);
    await expect(q("select public.reorder_modules($1, $2)", [c2, ids.slice(1)])).rejects.toThrow(/every module/);
    const ls = await lessonsOf(ids[0]);
    await q("select public.reorder_lessons($1, $2)", [ids[0], [...ls].reverse()]);
    expect(await lessonsOf(ids[0])).toEqual([...ls].reverse());
  });

  it("links an L8 topic to the catalog by slug, and queues v2 jobs", async () => {
    await q("insert into public.catalog_topics (slug, name, audience_level, origin) values ('cold-outreach', 'Cold outreach', 'beginner', 'owner')");
    await q("update public.topics set catalog_slug = 'cold-outreach' where slug = 'cold-outreach'");
    await expect(q("update public.topics set catalog_slug = 'not-a-catalog-topic' where slug = 'copywriting'")).rejects.toThrow(/foreign key/);
    await expect(q("update public.topics set catalog_slug = 'cold-outreach' where slug = 'copywriting'")).rejects.toThrow(/duplicate key/);
    await expect(q(`insert into public.catalog_jobs (batch_id, topic_slug, topic_name, audience_level, estimate_usd, queued_by_account_id, structure)
      values (gen_random_uuid(), 'cold-outreach', 'Cold outreach', 'beginner', 1, $1, 3)`, [owner])).rejects.toThrow(/check/);
  });

  it("a learner calling Supabase directly reads none of it: slots, briefs, uploads, reviews, boosters", async () => {
    for (const t of ["video_slots", "video_uploads", "module_reviews", "booster_types"]) {
      expect((await asRole(db.client, "authenticated", clerkClaims("user_learner"), `select * from public.${t}`)).error, t).toMatch(/permission denied/);
      expect((await asRole(db.client, "anon", null, `select * from public.${t}`)).error, t).toMatch(/permission denied/);
    }
    for (const f of ["accept_video_upload(uuid)", "new_course_version(uuid, uuid)", "reorder_modules(uuid, uuid[])"]) {
      expect((await q(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as x`)).rows[0].x, f).toBe(false);
    }
  });

  it("refuses C1 on a database without L8", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0019")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/C1.sql"))).rejects.toThrow(/apply L8 \(0019\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
