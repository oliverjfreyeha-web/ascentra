import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, asRole, clerkClaims, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L8 (0019): topics, picks and anonymous demand, with the plan rules held by the database in one transaction. */
describe("the L8 bundle on the live L7 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  const ids: Record<string, string> = {};
  const topic = async (slug: string) => (await q("select id from public.topics where slug = $1", [slug])).rows[0].id as string;
  const pick = async (who: string, slug: string, plan: string) =>
    (await q("select public.pick_topic($1, $2, $3) as r", [ids[who], await topic(slug), plan])).rows[0].r as Record<string, unknown>;
  const pause = async (who: string, slug: string, plan: string) =>
    (await q("select public.pause_pick($1, $2, $3) as r", [ids[who], await topic(slug), plan])).rows[0].r as Record<string, unknown>;
  const active = async (who: string, kind: string) =>
    (await q(`select t.slug from public.learner_picks p join public.topics t on t.id = p.topic_id
              where p.user_id = $1 and p.kind = $2 and p.status = 'active' order by t.slug`, [ids[who], kind])).rows.map((r) => r.slug);
  const learner = async (key: string, minor = false) => {
    // A teen learner is active only with a verified Guardian (B3); the fixture skips that check to stay small.
    if (minor) await q("set session_replication_role = replica");
    ids[key] = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, is_minor, clerk_updated_at)
      values ($1, $2, true, 'learner', $3, now()) returning id`, [`user_${key}`, `${key}@example.com`, minor])).rows[0].id;
    if (minor) await q("set session_replication_role = default");
    await q("insert into public.profiles (account_id, display_name) values ($1, $2)", [ids[key], key]);
  };

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0019")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    for (const k of ["basic", "trial", "pro", "down", "race", "race2", "race3", "other"]) await learner(k);
    await learner("teen", true);
    await q(readSql("db/apply/L8.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; verify.sql finds L8 in place (and C1 not yet applied)", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 4 missing.*L8 applied, C1 NOT applied$/);
  });

  it("seeds 24 businesses and 16 skills, all published, five businesses hidden from teens, no skill hidden", async () => {
    const { rows } = await q(`select kind, count(*)::int as n, count(*) filter (where published)::int as published,
      array_agg(slug order by slug) filter (where teen_hidden) as hidden, count(*) filter (where has_course)::int as courses
      from public.topics group by kind order by kind`);
    expect(rows).toEqual([
      { kind: "business", n: 24, published: 24, courses: 0,
        hidden: ["affiliate-marketing", "amazon-fba", "dropshipping", "online-coaching", "online-reselling"] },
      { kind: "skill", n: 16, published: 16, courses: 0, hidden: null },
    ]);
  });

  it("never promises income in the seeded names and blurbs", async () => {
    const { rows } = await q("select slug, name || ' ' || blurb as text from public.topics");
    for (const r of rows) expect(r.text, r.slug).not.toMatch(/\$|\b(income|earn(s|ing|ings)?|profits?|guarantee[sd]?|passive|rich|money|six.figure)\b|make \d/i);
  });

  it("keeps the API's service role from writing picks or demand counts directly", async () => {
    const t = await topic("copywriting");
    const r = await asRole(db.client, "service_role", null, "insert into public.learner_picks (user_id, topic_id, kind) values ($1, $2, 'skill')", [ids.basic, t]);
    expect(r.error).toMatch(/permission denied/);
    expect((await asRole(db.client, "service_role", null, "update public.topic_interest set count = 99")).error).toMatch(/permission denied/);
    expect((await asRole(db.client, "service_role", null, "select public.pick_topic($1, $2, 'basic') as r", [ids.other, t])).rows?.[0].r).toMatchObject({ result: "picked" });
  });

  describe("Basic", () => {
    it("allows 3 active skills, refuses a 4th, and lets a skill be swapped", async () => {
      expect(await pick("basic", "copywriting", "basic")).toMatchObject({ result: "picked", kind: "skill" });
      expect(await pick("basic", "negotiation", "basic")).toMatchObject({ result: "picked" });
      expect(await pick("basic", "public-speaking", "basic")).toMatchObject({ result: "picked" });
      expect(await pick("basic", "copywriting", "basic")).toMatchObject({ result: "already" });
      expect(await pick("basic", "time-management", "basic")).toEqual({ result: "limit", limit: 3, used: 3 });
      expect(await pause("basic", "negotiation", "basic")).toMatchObject({ result: "paused" });
      expect(await pick("basic", "time-management", "basic")).toMatchObject({ result: "picked" });
      expect(await active("basic", "skill")).toEqual(["copywriting", "public-speaking", "time-management"]);
      // The swapped-out skill is kept, paused.
      expect((await q("select status from public.learner_picks where user_id = $1 and topic_id = $2", [ids.basic, await topic("negotiation")])).rows).toEqual([{ status: "paused" }]);
    });

    it("locks the business once chosen; the learner can neither switch nor pause it", async () => {
      expect(await pick("basic", "seo-services", "basic")).toMatchObject({ result: "picked", kind: "business" });
      expect(await pick("basic", "newsletter", "basic")).toMatchObject({ result: "locked" });
      expect(await pause("basic", "seo-services", "basic")).toEqual({ result: "locked" });
      expect((await q("select locked from public.learner_picks where user_id = $1 and kind = 'business'", [ids.basic])).rows).toEqual([{ locked: true }]);
    });

    it("lets only the Owner's function change or release the business", async () => {
      const r = (await q("select public.owner_set_business($1, $2, 'basic') as r", [ids.basic, await topic("newsletter")])).rows[0].r;
      expect(r).toMatchObject({ result: "changed", previous: await topic("seo-services"), next: await topic("newsletter") });
      expect(await active("basic", "business")).toEqual(["newsletter"]);
      expect((await q("select public.owner_set_business($1, null, 'basic') as r", [ids.basic])).rows[0].r).toMatchObject({ result: "released" });
      expect(await active("basic", "business")).toEqual([]);
      // Released: the learner chooses once more, and it locks again.
      expect(await pick("basic", "seo-services", "basic")).toMatchObject({ result: "picked" });
      expect(await pick("basic", "newsletter", "basic")).toMatchObject({ result: "locked" });
      // The service role can call it, but no learner role can.
      expect((await asRole(db.client, "authenticated", clerkClaims("user_basic"), "select public.owner_set_business($1, null, 'basic')", [ids.basic])).error).toMatch(/permission denied/);
    });
  });

  describe("trial", () => {
    it("has the Basic limits: 3 skills and one locked business", async () => {
      for (const s of ["sales-fundamentals", "cold-outreach", "discovery-calls"]) expect(await pick("trial", s, "trial")).toMatchObject({ result: "picked" });
      expect(await pick("trial", "copywriting", "trial")).toMatchObject({ result: "limit" });
      expect(await pick("trial", "graphic-design", "trial")).toMatchObject({ result: "picked" });
      expect(await pick("trial", "video-editing", "trial")).toMatchObject({ result: "locked" });
    });
  });

  describe("Pro", () => {
    it("allows any number of skills", async () => {
      const skills = (await q("select slug from public.topics where kind = 'skill' order by sort_order limit 8")).rows.map((r) => r.slug);
      for (const s of skills) expect(await pick("pro", s, "pro")).toMatchObject({ result: "picked" });
      expect(await active("pro", "skill")).toHaveLength(8);
    });

    it("keeps one active business; switching pauses the old one and keeps it", async () => {
      expect(await pick("pro", "youtube-channel", "pro")).toMatchObject({ result: "picked" });
      expect(await pick("pro", "newsletter", "pro")).toMatchObject({ result: "picked", previous: await topic("youtube-channel") });
      expect(await active("pro", "business")).toEqual(["newsletter"]);
      const { rows } = await q("select t.slug, p.status, p.locked from public.learner_picks p join public.topics t on t.id = p.topic_id where p.user_id = $1 and p.kind = 'business' order by t.slug", [ids.pro]);
      expect(rows).toEqual([{ slug: "newsletter", status: "active", locked: false }, { slug: "youtube-channel", status: "paused", locked: false }]);
      // Switching back reactivates the kept pick.
      expect(await pick("pro", "youtube-channel", "pro")).toMatchObject({ result: "picked" });
      expect(await active("pro", "business")).toEqual(["youtube-channel"]);
    });

    it("never holds two active businesses, even written around the functions", async () => {
      await expect(q(`insert into public.learner_picks (user_id, topic_id, kind) values ($1, $2, 'business')`, [ids.pro, await topic("seo-services")])).rejects.toThrow(/learner_picks_one_business/);
    });
  });

  describe("Pro to Basic", () => {
    it("keeps the active business (now locked) and 3 skills active, pauses the rest, deletes nothing", async () => {
      const skills = (await q("select slug from public.topics where kind = 'skill' order by sort_order limit 6")).rows.map((r) => r.slug);
      for (const s of skills) await pick("down", s, "pro");
      await pick("down", "print-on-demand", "pro");
      const before = (await q("select count(*)::int as n from public.learner_picks where user_id = $1", [ids.down])).rows[0].n;
      expect((await q("select public.reconcile_picks($1, 'basic') as n", [ids.down])).rows[0].n).toBe(3);
      expect(await active("down", "skill")).toHaveLength(3);
      // The three most recently picked stay active.
      expect(await active("down", "skill")).toEqual(skills.slice(3).sort());
      expect((await q("select locked, status from public.learner_picks where user_id = $1 and kind = 'business'", [ids.down])).rows).toEqual([{ locked: true, status: "active" }]);
      expect((await q("select count(*)::int as n from public.learner_picks where user_id = $1", [ids.down])).rows[0].n).toBe(before);
      // Running it again changes nothing; back on Pro the business unlocks and paused skills can be picked again.
      expect((await q("select public.reconcile_picks($1, 'basic') as n", [ids.down])).rows[0].n).toBe(0);
      await q("select public.reconcile_picks($1, 'pro')", [ids.down]);
      expect((await q("select locked from public.learner_picks where user_id = $1 and kind = 'business'", [ids.down])).rows).toEqual([{ locked: false }]);
      expect(await pick("down", skills[0], "pro")).toMatchObject({ result: "picked" });
    });
  });

  describe("teens", () => {
    it("can't pick a teen_hidden topic, even through the Owner's function", async () => {
      expect(await pick("teen", "amazon-fba", "basic")).toEqual({ result: "not_available" });
      expect(await pick("teen", "affiliate-marketing", "basic")).toEqual({ result: "not_available" });
      expect((await q("select public.owner_set_business($1, $2, 'basic') as r", [ids.teen, await topic("dropshipping")])).rows[0].r).toEqual({ result: "not_available" });
      expect(await pick("teen", "print-on-demand", "basic")).toMatchObject({ result: "picked" });
    });

    it("an adult can pick the same topic", async () => {
      expect(await pick("other", "amazon-fba", "basic")).toMatchObject({ result: "picked" });
    });

    it("a pick on a topic later hidden from teens is paused, not deleted", async () => {
      await q("update public.topics set teen_hidden = true where slug = 'print-on-demand'");
      await q("select public.reconcile_picks($1, 'basic')", [ids.teen]);
      expect((await q("select status, locked from public.learner_picks where user_id = $1", [ids.teen])).rows).toEqual([{ status: "paused", locked: false }]);
      await q("update public.topics set teen_hidden = false where slug = 'print-on-demand'");
    });
  });

  it("nobody can pick an unpublished topic", async () => {
    await q("update public.topics set published = false where slug = 'podcast-editing-voiceover'");
    expect(await pick("other", "podcast-editing-voiceover", "pro")).toEqual({ result: "not_available" });
    await q("update public.topics set published = true where slug = 'podcast-editing-voiceover'");
  });

  it("refuses a pick without a plan", async () => {
    await expect(q("select public.pick_topic($1, $2, 'none')", [ids.other, await topic("copywriting")])).rejects.toThrow(/picks need a plan/);
  });

  it("counts anonymous demand per topic per day when it has no course; never when it has one", async () => {
    const t = await topic("ugc-content");
    const before = (await q("select coalesce(sum(count), 0)::int as n from public.topic_interest where topic_id = $1", [t])).rows[0].n;
    await pick("race", "ugc-content", "pro");
    await pick("race2", "ugc-content", "pro");
    await pick("race2", "ugc-content", "pro"); // already picked: not counted twice
    expect((await q("select coalesce(sum(count), 0)::int as n from public.topic_interest where topic_id = $1", [t])).rows[0].n).toBe(before + 2);
    await q("update public.topics set has_course = true where slug = 'lead-generation'");
    await pick("race", "lead-generation", "pro");
    expect((await q("select count(*)::int as n from public.topic_interest where topic_id = $1", [await topic("lead-generation")])).rows[0].n).toBe(0);
    const cols = (await q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'topic_interest'")).rows.map((r) => r.column_name);
    expect(cols.some((c) => /account|user/.test(c))).toBe(false);
  });

  describe("parallel picks cannot pass the limits", () => {
    it("ten parallel skill picks on Basic leave exactly 3 active", async () => {
      const skills = (await q("select id from public.topics where kind = 'skill' order by sort_order limit 10")).rows.map((r) => r.id as string);
      const clients = await Promise.all(skills.map(async () => { const c = new pg.Client({ connectionString: db.url }); await c.connect(); return c; }));
      try {
        const results = await Promise.all(skills.map((s, i) => clients[i].query("select public.pick_topic($1, $2, 'basic') as r", [ids.race2, s]).then((r) => r.rows[0].r.result as string)));
        expect(results.filter((r) => r === "picked")).toHaveLength(3);
        expect(results.filter((r) => r === "limit")).toHaveLength(7);
        expect(await active("race2", "skill")).toHaveLength(3);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    });

    it("parallel business picks on Basic leave exactly one, locked", async () => {
      const biz = (await q("select id from public.topics where kind = 'business' and not teen_hidden order by sort_order limit 6")).rows.map((r) => r.id as string);
      const clients = await Promise.all(biz.map(async () => { const c = new pg.Client({ connectionString: db.url }); await c.connect(); return c; }));
      try {
        const results = await Promise.all(biz.map((b, i) => clients[i].query("select public.pick_topic($1, $2, 'basic') as r", [ids.race3, b]).then((r) => r.rows[0].r.result as string)));
        expect(results.filter((r) => r === "picked")).toHaveLength(1);
        expect(results.filter((r) => r === "locked")).toHaveLength(5);
        expect((await q("select count(*)::int as n from public.learner_picks where user_id = $1 and kind = 'business' and status = 'active' and locked", [ids.race3])).rows[0].n).toBe(1);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    });
  });

  describe("a learner calling Supabase directly (bypassing the API)", () => {
    it("reads only their own picks, never another learner's", async () => {
      const r = await asRole(db.client, "authenticated", clerkClaims("user_basic"), "select distinct user_id from public.learner_picks");
      expect(r.rows).toEqual([{ user_id: ids.basic }]);
      const other = await asRole(db.client, "authenticated", clerkClaims("user_basic"), "select * from public.learner_picks where user_id = $1", [ids.pro]);
      expect(other.rows).toEqual([]);
    });

    it("can't write a pick, their own included", async () => {
      const t = await topic("negotiation");
      expect((await asRole(db.client, "authenticated", clerkClaims("user_basic"), "insert into public.learner_picks (user_id, topic_id, kind) values ($1, $2, 'skill')", [ids.basic, t])).error).toMatch(/permission denied/);
      expect((await asRole(db.client, "authenticated", clerkClaims("user_basic"), "update public.learner_picks set locked = false")).error).toMatch(/permission denied/);
      expect((await asRole(db.client, "authenticated", clerkClaims("user_basic"), "select public.pick_topic($1, $2, 'pro')", [ids.basic, t])).error).toMatch(/permission denied/);
    });

    it("an adult sees all published topics; a teen never sees teen_hidden ones; nobody sees unpublished ones", async () => {
      await q("update public.topics set published = false where slug = 'newsletter'");
      const adult = await asRole(db.client, "authenticated", clerkClaims("user_other"), "select slug from public.topics");
      const teen = await asRole(db.client, "authenticated", clerkClaims("user_teen"), "select slug, teen_hidden from public.topics");
      await q("update public.topics set published = true where slug = 'newsletter'");
      expect(adult.rows).toHaveLength(39);
      expect(adult.rows!.map((r) => r.slug)).toContain("amazon-fba");
      expect(adult.rows!.map((r) => r.slug)).not.toContain("newsletter");
      expect(teen.rows).toHaveLength(34);
      expect(teen.rows!.some((r) => r.teen_hidden)).toBe(false);
      // Asking for a hidden topic by name returns nothing.
      expect((await asRole(db.client, "authenticated", clerkClaims("user_teen"), "select * from public.topics where slug = 'amazon-fba'")).rows).toEqual([]);
    });

    it("anon and an unknown signed-in user see nothing; nobody reads demand counts", async () => {
      expect((await asRole(db.client, "anon", null, "select * from public.topics")).error).toMatch(/permission denied/);
      expect((await asRole(db.client, "authenticated", clerkClaims("user_nobody"), "select * from public.topics")).rows).toEqual([]);
      expect((await asRole(db.client, "authenticated", clerkClaims("user_basic"), "select * from public.topic_interest")).error).toMatch(/permission denied/);
    });
  });

  it("keeps the five answers whole on the profile: all set, or none", async () => {
    await expect(q("update public.profiles set path_goal = 'start' where account_id = $1", [ids.other])).rejects.toThrow(/profiles_path_answers/);
    await expect(q("update public.profiles set path_goal = 'rich', path_hours = 5, path_experience = 'none', path_style = 'build', path_camera = 'no', path_answered_at = now() where account_id = $1", [ids.other])).rejects.toThrow(/check/);
    await q("update public.profiles set path_goal = 'start', path_hours = 5, path_experience = 'none', path_style = 'build', path_camera = 'no', path_answered_at = now() where account_id = $1", [ids.other]);
  });

  it("refuses L8 on a database without L7", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0018")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L8.sql"))).rejects.toThrow(/apply L7 \(0018\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
