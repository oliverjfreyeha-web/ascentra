import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, asRole, clerkClaims, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/**
 * C2 (0021): side hustles (and the picks that move with them), the new pick rules, course size tiers, importance
 * labels, completions with the learner's own day, streaks, the adult leaderboard, and privacy of the new tables.
 * Applied as the SQL Editor bundle to a live C1 database that already has picks. Test-only data.
 */
const MOVED = ["affiliate-marketing", "amazon-fba", "digital-products", "dropshipping", "faceless-content", "newsletter", "online-reselling",
  "print-on-demand", "shopify-store", "ugc-content", "website-design", "youtube-channel"];
const STAY = ["ai-automation-agency", "ai-content-copywriting", "graphic-design", "lead-generation", "no-code-apps", "online-coaching", "online-tutoring",
  "podcast-editing-voiceover", "seo-services", "social-media-marketing-agency", "video-editing", "virtual-assistant"];

describe("the C2 bundle on the live C1 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  const ids: Record<string, string> = {};
  let owner = "", reviewer = "", source = "";
  const topic = async (slug: string) => (await q("select id from public.topics where slug = $1", [slug])).rows[0].id as string;
  const pick = async (who: string, slug: string, plan: string) =>
    (await q("select public.pick_topic($1, $2, $3) as r", [ids[who], await topic(slug), plan])).rows[0].r as Record<string, unknown>;
  const pause = async (who: string, slug: string, plan: string) =>
    (await q("select public.pause_pick($1, $2, $3) as r", [ids[who], await topic(slug), plan])).rows[0].r as Record<string, unknown>;
  const picks = async (who: string) => (await q(`select t.slug, p.kind, p.status, p.locked from public.learner_picks p join public.topics t on t.id = p.topic_id
      where p.user_id = $1 order by p.kind, t.slug`, [ids[who]])).rows;
  const active = async (who: string, kind: string) =>
    (await q(`select t.slug from public.learner_picks p join public.topics t on t.id = p.topic_id
              where p.user_id = $1 and p.kind = $2 and p.status = 'active' order by t.slug`, [ids[who], kind])).rows.map((r) => r.slug);
  const learner = async (key: string, minor = false) => {
    if (minor) await q("set session_replication_role = replica");
    ids[key] = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, is_minor, clerk_updated_at)
      values ($1, $2, true, 'learner', $3, now()) returning id`, [`user_${key}`, `${key}@example.com`, minor])).rows[0].id;
    if (minor) await q("set session_replication_role = default");
    await q("insert into public.profiles (account_id, display_name) values ($1, $2)", [ids[key], key]);
  };
  const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
  /** A v2 Blueprint for a new test course, approved; returns the course id. */
  const course = async (slug: string, modules: number, tier?: string) => {
    const academy = (await q("insert into public.academies (slug, name) values ($1, 'Test course') returning id", [slug])).rows[0].id;
    const mod = (mi: number) => ({ title: `Test module ${mi}`, stage: "Foundations", recipe: { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 1, boosters: [] },
      lessons: [{ title: `Test lesson ${mi}`, minutes: 10, objectives: ["Test"], keyClaims: [{ claim: "Test claim.", sourceId: source }] }],
      skills: [], videos: [{ title: `Test video ${mi}`, brief: { points: [{ text: "Test point" }] } }] });
    const bp = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by)
      values ($1, $2, 'course', 'Test', 'beginner', $3, 'ai') returning id`,
    [owner, academy, JSON.stringify({ structure: 2, ...(tier ? { sizeTier: tier } : {}), title: "Test", outcome: "Test", modules: Array.from({ length: modules }, (_, i) => mod(i + 1)) })])).rows[0].id;
    return (await q("select public.approve_course_blueprint($1, $2) as id", [bp, owner])).rows[0].id as string;
  };

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0021")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    owner = await acc("user_owner", "owner");
    reviewer = await acc("user_reviewer", "admin");
    source = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
      values ('Test study', 'web', 'https://example.org/test', 'approved', $1, now()) returning id`, [reviewer])).rows[0].id;
    for (const k of ["moved", "both", "basic", "solo", "pro", "down", "race", "board1", "board2", "optout", "removed", "nonick", "streak", "tz1", "tz2"]) await learner(k);
    await learner("teen", true);
    // Picks made under L8, before C2: a moved business (active, locked), and a moved one that was set aside.
    await pick("moved", "website-design", "basic");
    await pick("both", "shopify-store", "pro");
    await pick("both", "seo-services", "pro");
    await pick("both", "copywriting", "pro");
    await q(readSql("db/apply/C2.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql is OK with 82 tables", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 0 missing, 0 without RLS, 0 unexpected.*C2 applied, I1 NOT applied$/);
  });

  describe("side hustles", () => {
    it("moves exactly the twelve topics, keeping their slugs, publish state and teen setting; twelve businesses stay", async () => {
      const { rows } = await q("select kind, array_agg(slug order by slug) as slugs, bool_and(published) as published from public.topics where kind <> 'skill' group by kind order by kind");
      expect(rows).toEqual([{ kind: "business", slugs: STAY, published: true }, { kind: "side_hustle", slugs: MOVED, published: true }]);
      const hidden = (await q("select slug from public.topics where teen_hidden order by slug")).rows.map((r) => r.slug);
      expect(hidden).toEqual(["affiliate-marketing", "amazon-fba", "dropshipping", "online-coaching", "online-reselling"]);
      expect((await q("select count(*)::int as n, bool_and(previous_kind = 'business') as was from private.c2_moved_topics")).rows[0]).toEqual({ n: 12, was: true });
    });

    it("keeps every existing pick: a moved business becomes the learner's side hustle (still active and locked); a set-aside one stays set aside", async () => {
      expect(await picks("moved")).toEqual([{ slug: "website-design", kind: "side_hustle", status: "active", locked: true }]);
      expect(await picks("both")).toEqual([
        { slug: "seo-services", kind: "business", status: "active", locked: false },
        { slug: "shopify-store", kind: "side_hustle", status: "paused", locked: false },
        { slug: "copywriting", kind: "skill", status: "active", locked: false },
      ]);
    });

    it("Basic: 1 business and 1 side hustle, each locked once picked; a side hustle without a business is fine", async () => {
      expect(await pick("basic", "seo-services", "basic")).toMatchObject({ result: "picked", kind: "business" });
      expect(await pick("basic", "newsletter", "basic")).toMatchObject({ result: "picked", kind: "side_hustle" });
      expect(await pick("basic", "youtube-channel", "basic")).toMatchObject({ result: "locked", kind: "side_hustle" });
      expect(await pick("basic", "video-editing", "basic")).toMatchObject({ result: "locked", kind: "business" });
      expect(await pause("basic", "newsletter", "basic")).toEqual({ result: "locked" });
      expect(await pick("solo", "print-on-demand", "trial")).toMatchObject({ result: "picked", kind: "side_hustle" });
      expect(await active("solo", "business")).toEqual([]);
      for (const s of ["copywriting", "negotiation", "public-speaking"]) expect(await pick("basic", s, "basic")).toMatchObject({ result: "picked" });
      expect(await pick("basic", "time-management", "basic")).toMatchObject({ result: "limit", limit: 3 });
    });

    it("Pro: unlimited skills; switching the side hustle pauses the old one (kept)", async () => {
      expect(await pick("pro", "newsletter", "pro")).toMatchObject({ result: "picked" });
      expect(await pick("pro", "youtube-channel", "pro")).toMatchObject({ result: "picked", previous: await topic("newsletter") });
      expect(await active("pro", "side_hustle")).toEqual(["youtube-channel"]);
      expect((await picks("pro")).find((p) => p.slug === "newsletter")).toMatchObject({ status: "paused", locked: false });
      for (const s of ["copywriting", "negotiation", "public-speaking", "time-management", "email-marketing"]) expect(await pick("pro", s, "pro")).toMatchObject({ result: "picked" });
    });

    it("Pro to Basic: the business, the side hustle and 3 skills stay active (locked); the rest are paused, nothing deleted", async () => {
      await pick("down", "seo-services", "pro");
      await pick("down", "newsletter", "pro");
      for (const s of ["copywriting", "negotiation", "public-speaking", "time-management", "email-marketing"]) await pick("down", s, "pro");
      const before = (await picks("down")).length;
      expect((await q("select public.reconcile_picks($1, 'basic') as n", [ids.down])).rows[0].n).toBe(2);
      expect(await active("down", "business")).toEqual(["seo-services"]);
      expect(await active("down", "side_hustle")).toEqual(["newsletter"]);
      expect(await active("down", "skill")).toHaveLength(3);
      expect((await picks("down")).length).toBe(before);
      expect((await picks("down")).filter((p) => p.kind !== "skill").every((p) => p.locked)).toBe(true);
    });

    it("teens: a side hustle hidden from teens can't be picked, even by the Owner for them", async () => {
      expect(await pick("teen", "amazon-fba", "basic")).toEqual({ result: "not_available" });
      expect((await q("select public.owner_set_pick($1, 'side_hustle', $2, 'basic') as r", [ids.teen, await topic("amazon-fba")])).rows[0].r).toEqual({ result: "not_available" });
      expect(await pick("teen", "newsletter", "basic")).toMatchObject({ result: "picked" });
    });

    it("the Owner changes or releases a side hustle; the business function still works", async () => {
      const r = (await q("select public.owner_set_pick($1, 'side_hustle', $2, 'basic') as r", [ids.basic, await topic("youtube-channel")])).rows[0].r;
      expect(r).toMatchObject({ result: "changed", previous: await topic("newsletter") });
      expect((await q("select public.owner_set_pick($1, 'side_hustle', $2, 'basic') as r", [ids.basic, await topic("seo-services")])).rows[0].r).toEqual({ result: "not_available" });
      expect((await q("select public.owner_set_business($1, null, 'basic') as r", [ids.basic])).rows[0].r).toMatchObject({ result: "released" });
      await expect(q("select public.owner_set_pick($1, 'skill', null, 'basic')", [ids.basic])).rejects.toThrow(/business or a side hustle/);
    });

    it("concurrency: two side hustles picked at the same moment on Basic, exactly one wins", async () => {
      const both = [await topic("faceless-content"), await topic("digital-products")];
      const clients = await Promise.all(both.map(async () => { const c = new pg.Client({ connectionString: db.url }); await c.connect(); return c; }));
      try {
        const results = await Promise.all(both.map((t, i) => clients[i].query("select public.pick_topic($1, $2, 'basic') as r", [ids.race, t]).then((r) => r.rows[0].r.result as string)));
        expect(results.sort()).toEqual(["locked", "picked"]);
        expect(await active("race", "side_hustle")).toHaveLength(1);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    });

    it("cost and outlook need sources and a checked date; skills can't have them", async () => {
      const t = await topic("newsletter");
      await expect(q("update public.topics set cost_low = 10, cost_high = 50 where id = $1", [t])).rejects.toThrow(/topics_cost_sourced/);
      await q(`update public.topics set cost_low = 10, cost_high = 50, cost_checked_on = '2026-10-01', cost_sources = '[{"title":"Test source","url":"https://example.org/x"}]' where id = $1`, [t]);
      await expect(q("update public.topics set outlook_label = 'growing' where id = $1", [t])).rejects.toThrow(/topics_outlook_sourced/);
      await expect(q("update public.topics set difficulty = 3 where slug = 'copywriting'")).rejects.toThrow(/topics_skill_fields/);
      await expect(q("update public.topics set cost_low = 60, cost_high = 50 where id = $1", [t])).rejects.toThrow(/topics_cost_range/);
    });
  });

  describe("course size tiers", () => {
    it("a Compact course has 3 or 4 modules, Standard 5 or 6 (the default), Large 7 to 9", async () => {
      expect((await q("select size_tier from public.courses where id = $1", [await course("tier-c3", 3, "compact")])).rows[0].size_tier).toBe("compact");
      await expect(course("tier-c5", 5, "compact")).rejects.toThrow(/Compact course has 3 to 4 modules/);
      await expect(course("tier-s4", 4, "standard")).rejects.toThrow(/Standard course has 5 to 6 modules/);
      expect((await q("select size_tier from public.courses where id = $1", [await course("tier-s6", 6, "standard")])).rows[0].size_tier).toBe("standard");
      // A v2 plan without a tier keeps C1's rule and behaviour (no tier: no C2 rules).
      await expect(course("tier-none4", 4)).rejects.toThrow(/5 or 6 modules/);
      expect((await q("select size_tier from public.courses where id = $1", [await course("tier-none5", 5)])).rows[0].size_tier).toBeNull();
      expect((await q("select size_tier from public.courses where id = $1", [await course("tier-l8", 8, "large")])).rows[0].size_tier).toBe("large");
      await expect(course("tier-l10", 10, "large")).rejects.toThrow(/Large course has 7 to 9 modules/);
    });
  });

  describe("importance labels", () => {
    let courseId = "", moduleId = "", lessonId = "";
    const item = async () => (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key, explanation, citation)
      values ($1, $2, $3, 'test-idea', 'multiple_choice', 'code', 'beginner', 'Test goal', 'Test prompt?', '{"options":["A","B"]}', '{"correct":0}', 'Test.', $4) returning id`,
    [lessonId, moduleId, courseId, JSON.stringify({ sourceId: source, title: "Test study" })])).rows[0].id as string;
    const approve = (id: string) => q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now() where id = $1", [id, reviewer]);
    beforeAll(async () => {
      courseId = await course("labels", 5, "standard");
      moduleId = (await q("select id from public.modules where course_id = $1 and position = 1", [courseId])).rows[0].id;
      lessonId = (await q("select id from public.lessons where module_id = $1", [moduleId])).rows[0].id;
    });

    it("an item is approved only with a label, and a Very important one only with its Notebook note", async () => {
      const a = await item();
      await expect(approve(a)).rejects.toThrow(/label this item/);
      await q("update public.activity_items set importance = 'very_important' where id = $1", [a]);
      await expect(approve(a)).rejects.toThrow(/needs its Notebook note/);
      await q("update public.activity_items set notebook_note = 'Test note: reply within minutes, not hours.' where id = $1", [a]);
      await approve(a);
      await expect(q("update public.activity_items set importance = 'important' where id = $1", [a])).rejects.toThrow(/set while it is a Draft/);
    });

    it("the Owner can't approve a module while a video in it has no label", async () => {
      await expect(q(`insert into public.module_reviews (module_id, course_id, decision, lesson_version_ids, item_ids, decided_by_account_id)
        values ($1, $2, 'approved', '{}', '{}', $3)`, [moduleId, courseId, owner])).rejects.toThrow(/needs its importance label/);
    });

    it("a course without a size tier keeps C1's behaviour: no label needed", async () => {
      const old = await course("labels-c1", 5);
      const m = (await q("select id from public.modules where course_id = $1 and position = 1", [old])).rows[0].id;
      const l = (await q("select id from public.lessons where module_id = $1", [m])).rows[0].id;
      const id = (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key, explanation, citation)
        values ($1, $2, $3, 'test-idea', 'multiple_choice', 'code', 'beginner', 'Test goal', 'Test prompt?', '{"options":["A","B"]}', '{"correct":0}', 'Test.', $4) returning id`,
      [l, m, old, JSON.stringify({ sourceId: source, title: "Test study" })])).rows[0].id;
      await approve(id);
    });

    it("a new course version carries the size tier, notices, labels, notes and the capstone", async () => {
      const src = await course("carry", 3, "compact");
      await q("update public.video_slots s set importance = 'important' from public.modules m where m.id = s.module_id and m.course_id = $1", [src]);
      await q("update public.courses set status = 'published', published_at = now(), license_notice = 'Test: some places need a business license.' where id = $1", [src]);
      await q(`insert into public.course_capstones (course_id, title, deliverables, checklist) values ($1, 'Test capstone', '["Test deliverable"]', '["Test check"]')`, [src]);
      const academy = (await q("select academy_id from public.courses where id = $1", [src])).rows[0].academy_id;
      const next = (await q("select public.new_course_version($1, $2) as id", [academy, owner])).rows[0].id;
      expect((await q("select size_tier, license_notice from public.courses where id = $1", [next])).rows[0]).toEqual({ size_tier: "compact", license_notice: "Test: some places need a business license." });
      expect((await q("select distinct s.importance from public.video_slots s join public.modules m on m.id = s.module_id where m.course_id = $1", [next])).rows).toEqual([{ importance: "important" }]);
      expect((await q("select title, deliverables from public.course_capstones where course_id = $1", [next])).rows).toEqual([{ title: "Test capstone", deliverables: ["Test deliverable"] }]);
    });
  });

  describe("completions, streaks and the leaderboard", () => {
    let courseId = "", moduleId = "", videoId = "";
    beforeAll(async () => {
      courseId = await course("progress", 5, "standard");
      moduleId = (await q("select id from public.modules where course_id = $1 and position = 1", [courseId])).rows[0].id;
      videoId = (await q("select id from public.video_slots where module_id = $1", [moduleId])).rows[0].id;
      // An approved video, through the C1 upload path.
      const up = (await q(`insert into public.video_uploads (slot_id, storage_path, mime, size_bytes, uploaded_by_account_id)
        values ($1::uuid, $1::text || '/' || gen_random_uuid() || '.mp4', 'video/mp4', 1000, $2) returning id`, [videoId, owner])).rows[0].id;
      await q("select public.accept_video_upload($1)", [up]);
      await q("update public.video_slots set status = 'approved', transcript = 'Test transcript long enough.', approved_at = now(), approved_by_account_id = $2 where id = $1", [videoId, owner]);
    });
    const complete = (who: string, kind = "video", item = videoId) =>
      q("select public.record_item_completion($1, $2, $3, $4, $5, null, 'important', 2) as r", [ids[who], kind, item, courseId, moduleId]);

    it("records a finished item once, on the learner's own day (their time zone)", async () => {
      await q("update public.profiles set time_zone = 'Pacific/Kiritimati' where account_id = $1", [ids.tz1]);
      await q("update public.profiles set time_zone = 'Pacific/Pago_Pago' where account_id = $1", [ids.tz2]);
      const a = (await complete("tz1")).rows[0].r;
      const b = (await complete("tz2")).rows[0].r;
      expect(a.created && b.created).toBe(true);
      // UTC+14 and UTC-11 are always on different calendar days.
      expect(a.local_day).not.toBe(b.local_day);
      expect((await complete("tz1")).rows[0].r.created).toBe(false);
      await expect(complete("tz1", "activity", videoId)).rejects.toThrow(/no such published item/);
      await expect(complete("tz1", "quiz")).rejects.toThrow(/unknown kind/);
      await expect(q("update public.profiles set time_zone = 'Mars/Olympus' where account_id = $1", [ids.tz1])).rejects.toThrow(/unknown time zone/);
    });

    it("completions are kept: the API can't write, change or delete them directly", async () => {
      expect((await asRole(db.client, "service_role", null, "insert into public.item_completions (account_id, course_id, item_kind, item_id, points, local_day) values ($1, $2, 'video', $3, 3, current_date)", [ids.tz1, courseId, videoId])).error).toMatch(/permission denied/);
      await expect(q("delete from public.item_completions where account_id = $1", [ids.tz1])).rejects.toThrow();
      await expect(q("update public.item_completions set points = 100 where account_id = $1", [ids.tz1])).rejects.toThrow();
    });

    it("the streak: a run of days ending today or yesterday; a missed full day ends it; the longest run is kept", async () => {
      const add = (who: string, daysAgo: number, n: number) => q(`insert into public.item_completions (account_id, course_id, item_kind, item_id, points, local_day)
        values ($1, $2, 'video', gen_random_uuid(), $4, (now() at time zone 'America/New_York')::date - $3::integer)`, [ids[who], courseId, daysAgo, n]);
      for (const d of [1, 2, 3, 7, 8, 9, 10]) await add("streak", d, 1);
      expect((await q("select * from public.learner_progress_totals($1)", [ids.streak])).rows[0]).toEqual({ points: "7", current_streak: 3, longest_streak: 4 });
      await add("board1", 2, 5);
      expect((await q("select * from public.learner_progress_totals($1)", [ids.board1])).rows[0]).toMatchObject({ current_streak: 0, longest_streak: 1 });
      expect((await q("select * from public.learner_progress_totals($1)", [ids.nonick])).rows[0]).toEqual({ points: "0", current_streak: 0, longest_streak: 0 });
    });

    it("the board shows only adults with a nickname who didn't opt out: nickname, points, rank and streak, never a teen", async () => {
      const add = (who: string, n: number) => q(`insert into public.item_completions (account_id, course_id, item_kind, item_id, points, local_day)
        values ($1, $2, 'video', gen_random_uuid(), $3, (now() at time zone 'America/New_York')::date)`, [ids[who], courseId, n]);
      for (const [who, nick] of [["board1", "TestOne"], ["board2", "TestTwo"], ["optout", "TestOut"], ["removed", "TestGone"], ["teen", "TestTeen"]]) {
        await q("update public.profiles set nickname = $2, nickname_set_at = now() where account_id = $1", [ids[who], nick]);
        await add(who, 20);
      }
      await add("nonick", 99);
      await q("update public.profiles set leaderboard_opt_out = true where account_id = $1", [ids.optout]);
      await q("update public.profiles set nickname_removed_at = now() where account_id = $1", [ids.removed]);
      const { rows, fields } = await q("select * from public.leaderboard_adults(array[10, 30, 60], 50)");
      expect(fields.map((f) => f.name)).toEqual(["nickname", "points", "rank_index", "current_streak", "longest_streak"]);
      expect(rows.map((r) => r.nickname)).toEqual(["TestOne", "TestTwo"]);
      expect(rows[0]).toMatchObject({ points: "25", rank_index: 1 });
      await expect(q("update public.profiles set nickname = 'testone' where account_id = $1", [ids.board2])).rejects.toThrow(/profiles_nickname_unique/);
      await expect(q("update public.profiles set nickname = 'a@b.com' where account_id = $1", [ids.board2])).rejects.toThrow(/nickname_check/);
    });
  });

  describe("privacy", () => {
    it("no one reads the new tables or calls the board functions by calling Supabase directly", async () => {
      const ann = clerkClaims("user_board1");
      for (const t of ["item_completions", "notebook_entries", "account_regions", "mission_state_allowlist", "mission_approvals", "community_settings",
        "trial_bonuses", "course_capstones", "course_notice_views"]) {
        expect((await asRole(db.client, "authenticated", ann, `select * from public.${t}`)).error, t).toMatch(/permission denied/);
        expect((await asRole(db.client, "anon", null, `select * from public.${t}`)).error, t).toMatch(/permission denied/);
      }
      expect((await asRole(db.client, "authenticated", ann, "select * from public.leaderboard_adults(array[1], 10)")).error).toMatch(/permission denied/);
      expect((await asRole(db.client, "authenticated", ann, "select * from public.learner_progress_totals($1)", [ids.teen])).error).toMatch(/permission denied/);
      expect((await asRole(db.client, "authenticated", ann, "select * from public.notes")).error).toMatch(/permission denied/);
    });
  });
});

describe("C2 without C1", () => {
  it("refuses to apply on a database without 0020, changing nothing", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0020")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/C2.sql"))).rejects.toThrow(/apply C1 \(0020\) first/);
    } finally {
      await early.drop();
    }
  });
});
