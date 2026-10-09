import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L6 (0017): the topic catalog, the batch queue and the activity library's rules, held by the database. */
describe("the L6 bundle on the live L5 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string;
  let reviewer: string;
  let learner: string;
  let lesson: string;
  let mod: string;
  let course: string;
  let source: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0017")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
    owner = await acc("user_owner", "owner");
    reviewer = await acc("user_reviewer", "admin");
    learner = await acc("user_learner", "learner");
    await q(readSql("db/apply/L6.sql"));
    const academy = (await q("insert into public.academies (slug, name) values ('lead-basics', 'Lead basics') returning id")).rows[0].id;
    course = (await q("insert into public.courses (academy_id, version, status) values ($1, 1, 'draft') returning id", [academy])).rows[0].id;
    mod = (await q("insert into public.modules (course_id, position, code, title) values ($1, 1, 'm1', 'Speed') returning id", [course])).rows[0].id;
    lesson = (await q("insert into public.lessons (module_id, position, title) values ($1, 1, 'Why minutes matter') returning id", [mod])).rows[0].id;
    source = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
      values ('Speed study', 'web', 'https://example.org/speed', 'approved', $1, now()) returning id`, [reviewer])).rows[0].id;
  });
  afterAll(() => db.drop());

  const item = async (type: string, o: { key?: unknown; status?: string; prev?: string; idea?: string } = {}) => {
    const code = ["multiple_choice", "true_false", "matching", "ordering", "flashcard"].includes(type);
    return (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key, explanation, citation, previous_item_id)
      values ($1, $2, $3, $4, $5, $6, 'beginner', 'Reply fast', 'How fast should you reply?', '{"options":["5 min","1 day"]}', $7, 'The study says five minutes.', $8, $9) returning id`,
    [lesson, mod, course, o.idea ?? type.replace(/_/g, "-"), type, code ? "code" : "feedback", o.key === undefined ? (code ? JSON.stringify({ correct: 0 }) : null) : o.key,
      JSON.stringify({ sourceId: source, title: "Speed study" }), o.prev ?? null])).rows[0].id as string;
  };
  const approve = (id: string, by = reviewer) => q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now() where id = $1", [id, by]);

  it("applies in one go; verify.sql says L6 is applied (L7 not yet); the catalog holds the Academy Blueprint's topics", async () => {
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 7 missing.*L6 applied, L7 NOT applied, L8 NOT applied$/);
    expect((await q("select slug from public.catalog_topics order by slug")).rows.map((r) => r.slug)).toEqual(["content", "creator", "ecom", "mkt", "sales"]);
  });

  it("queues each topic once at a time, never the Owner Academy, and says what a waiting job waits for", async () => {
    const job = (slug: string, extra = "") => q(`insert into public.catalog_jobs (batch_id, topic_slug, topic_name, audience_level, estimate_usd, queued_by_account_id${extra ? ", status, waiting_for" : ""})
      values (gen_random_uuid(), $1, 'Topic', 'beginner', 1.5, $2${extra})`, [slug, owner]);
    await expect(job("gsa")).rejects.toThrow(/check/);
    await job("mkt");
    await expect(job("mkt")).rejects.toThrow(/catalog_jobs_one_open/);
    await expect(job("sales", ", 'waiting', null")).rejects.toThrow(/catalog_jobs_waiting/);
    await expect(job("sales", ", 'waiting', 'spend_cap'")).rejects.toThrow(/catalog_jobs_(waiting|held)/);
    await expect(job("sales", ", 'researching', 'spend_cap'")).rejects.toThrow(/catalog_jobs_held/);
    await job("sales", ", 'waiting', 'source_approval'");
    await job("ecom", ", 'queued', 'spend_cap'");
  });

  it("graded by code means the five types, always with an answer key; feedback-only never has one; items enter as Draft", async () => {
    await expect(item("multiple_choice", { key: null })).rejects.toThrow(/activity_items_grading/);
    await expect(item("short_answer", { key: JSON.stringify({ correct: "x" }) })).rejects.toThrow(/activity_items_grading/);
    await expect(q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, explanation, citation, status)
      values ($1, $2, $3, 'x', 'short_answer', 'feedback', 'beginner', 'goal', 'prompt', 'why', $4, 'approved')`, [lesson, mod, course, JSON.stringify({ sourceId: source })])).rejects.toThrow(/enters as Draft/);
    await expect(q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, explanation, citation)
      values ($1, $2, $3, 'x', 'short_answer', 'feedback', 'beginner', 'goal', 'prompt', 'why', '{}')`, [lesson, mod, course])).rejects.toThrow(/check/);
  });

  it("a Reviewer approves; a learner can't; a module needs 3 activity types to publish; a published item never changes", async () => {
    const mc = await item("multiple_choice");
    const tf = await item("true_false");
    await expect(approve(mc, learner)).rejects.toThrow(/reviewed by the Owner or a Reviewer/);
    await approve(mc);
    await approve(tf);
    await expect(q("update public.activity_items set prompt = 'changed' where id = $1", [mc])).rejects.toThrow(/only a Draft/);
    await expect(q("select public.publish_module_activities($1, $2)", [mod, owner])).rejects.toThrow(/at least 3 different activity types .*has 2/);
    await expect(q("update public.activity_items set status = 'published', published_at = now() where id = $1", [await item("ordering")])).rejects.toThrow(/only an approved/);
    const sa = await item("short_answer");
    await approve(sa);
    await expect(q("select public.publish_module_activities($1, $2)", [mod, learner])).rejects.toThrow(/Owner or a course builder/);
    expect((await q("select public.publish_module_activities($1, $2) as n", [mod, owner])).rows[0].n).toBe(3);
    await expect(q("update public.activity_items set prompt = 'changed' where id = $1", [mc])).rejects.toThrow(/not edited; a refresh drafts a new one/);
    await expect(q("delete from public.activity_items where id = $1", [mc])).rejects.toThrow(/kept/);
    // A refresh drafts a new item pointing at the published one; publishing it archives the old one.
    const next = await item("multiple_choice", { prev: mc, idea: "multiple-choice" });
    await approve(next);
    await q("select public.publish_module_activities($1, $2)", [mod, owner]);
    expect((await q("select id, status from public.activity_items where id in ($1, $2) order by status", [mc, next])).rows).toEqual([{ id: mc, status: "archived" }, { id: next, status: "published" }]);
  });

  it("attempts only on published items; only code-graded attempts are graded or counted; kept as recorded", async () => {
    const pub = (await q("select id, grading from public.activity_items where status = 'published' order by grading")).rows as { id: string; grading: string }[];
    const code = pub.find((p) => p.grading === "code")!.id;
    const practice = pub.find((p) => p.grading === "feedback")!.id;
    const draft = await item("matching");
    const attempt = (id: string, by: string, correct: boolean | null, counted: boolean, answer: unknown = null) =>
      q("insert into public.activity_attempts (item_id, account_id, graded_by, correct, counted, answer) values ($1, $2, $3, $4, $5, $6) returning id", [id, learner, by, correct, counted, answer]);
    await expect(attempt(draft, "code", true, true, JSON.stringify(0))).rejects.toThrow(/only on published/);
    await expect(attempt(practice, "code", true, true, JSON.stringify("x"))).rejects.toThrow(/only a code-graded item is graded/);
    await expect(attempt(practice, "none", null, true)).rejects.toThrow(/check/);
    await expect(attempt(practice, "none", null, false, JSON.stringify("my text"))).rejects.toThrow(/check/);
    await attempt(practice, "none", null, false);
    const id = (await attempt(code, "code", false, true, JSON.stringify(1))).rows[0].id;
    await expect(q("update public.activity_attempts set correct = true where id = $1", [id])).rejects.toThrow(/kept as recorded/);
  });

  it("keeps the new tables and the publish function away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.activity_items', 'select') as i,
      has_table_privilege('anon', 'public.catalog_jobs', 'select') as j,
      has_function_privilege('authenticated', 'public.publish_module_activities(uuid, uuid)', 'execute') as f`);
    expect(rows[0]).toEqual({ i: false, j: false, f: false });
  });

  it("refuses L6 on a database without L5", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0016")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L6.sql"))).rejects.toThrow(/apply L5 \(0016\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
