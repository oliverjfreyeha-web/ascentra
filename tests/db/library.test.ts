import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDb, migrationFiles, readSql, type TestDb } from "./helpers";

/** L1 (0012): the source library's rules, held by the database, applied as the SQL Editor bundle to a live B4 database. */
describe("the L1 bundle on the live B4 database", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  let owner: string;
  let reviewer: string;
  let learner: string;
  const vec = (hot: number) => `[${Array.from({ length: 1024 }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;
  let n = 0;
  const source = async (license = "open", status = "proposed", approver: string | null = null) => (await q(
    `insert into public.sources (title, source_type, url, license_class, status, approved_by_account_id, approved_at)
     values ($1, 'web', $2, $3, $4, $5, case when $5::uuid is null then null else now() end) returning id`,
    [`Source ${++n}`, `https://example.org/${n}`, license, status, approver])).rows[0].id as string;
  const approve = (id: string, by: string) => q("update public.sources set status = 'approved', approved_by_account_id = $2, approved_at = now() where id = $1", [id, by]);
  const chunks = (id: string, items: unknown[]) => q("select public.put_source_chunks($1, $2::jsonb) as n", [id, JSON.stringify(items)]);
  const claim = async (sourceId: string | null, text: string) => (await q(
    `insert into public.source_claims (source_id, claim, citation_status) values ($1, $2, $3) returning id`,
    [sourceId, text, sourceId ? "cited" : "no_source"])).rows[0].id as string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    for (const f of migrationFiles().filter((f) => f < "0012")) await q(readSql(`${MIGRATIONS_DIR}/${f}`));
    const acc = async (c: string, role: string) => (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
      values ($1, $1 || '@example.com', true, $2, now(), true) returning id`, [c, role])).rows[0].id as string;
    owner = await acc("user_owner", "owner");
    reviewer = await acc("user_reviewer", "admin");
    learner = await acc("user_learner", "learner");
    await q(readSql("db/apply/L1.sql"));
  });
  afterAll(() => db.drop());

  it("applies in one go; pgvector is on; verify.sql says L1 is applied (L2 not yet)", async () => {
    expect((await q("select extname from pg_extension where extname = 'vector'")).rows).toHaveLength(1);
    expect((await q(readSql("db/verify.sql"))).rows[0].table_name).toMatch(/^PROBLEM: 19 missing.*L1 applied, L2 NOT applied, L3 NOT applied, L4 NOT applied, L5 NOT applied, L6 NOT applied, L7 NOT applied, L8 NOT applied$/);
  });

  it("only the Owner approves an owner-supplied source; a Reviewer approves the others; a learner never", async () => {
    const supplied = await source("owner_supplied");
    await expect(approve(supplied, reviewer)).rejects.toThrow(/approved by the Owner/);
    await expect(approve(supplied, owner)).resolves.toBeDefined();
    const open = await source("open");
    await expect(approve(open, learner)).rejects.toThrow(/only the Owner or a Reviewer/);
    await expect(approve(open, reviewer)).resolves.toBeDefined();
    await expect(q("update public.sources set status = 'approved', approved_by_account_id = null where id = $1", [await source()])).rejects.toThrow(/sources_approved_by|only the Owner or a Reviewer/);
  });

  it("stores chunks with embeddings; a web_summarize_only source keeps only a short quote, yet stays searchable", async () => {
    const open = await source("open");
    await approve(open, reviewer);
    expect((await chunks(open, [
      { position: 0, text: "Speed to lead: respond to new leads within five minutes.", embedding: JSON.parse(vec(1)) },
      { position: 1, text: "Follow up three times in the first week.", embedding: JSON.parse(vec(2)) },
    ])).rows[0].n).toBe(2);
    const web = await source("web_summarize_only");
    await approve(web, reviewer);
    const longText = `Responding within an hour is enough for most service businesses. ${"Filler sentence about lead handling. ".repeat(40)}`;
    await chunks(web, [{ position: 0, text: longText, quote: "Responding within an hour is enough for most service businesses." }]);
    const kept = (await q("select content, is_excerpt from public.source_chunks where source_id = $1", [web])).rows[0];
    expect(kept).toEqual({ content: "Responding within an hour is enough for most service businesses.", is_excerpt: true });
    // Full-text search finds it by a word that's only in the (unstored) full text.
    const found = await q("select title, is_excerpt from public.match_source_chunks('filler lead handling', null, 5)");
    expect(found.rows.map((r) => r.is_excerpt)).toContain(true);
    // By embedding: the nearest chunk first, with its source and license.
    const byVec = await q("select content, license_class from public.match_source_chunks('', $1, 1)", [vec(2)]);
    expect(byVec.rows).toEqual([{ content: "Follow up three times in the first week.", license_class: "open" }]);
  });

  it("returns only approved sources", async () => {
    const proposed = await source("open");
    await chunks(proposed, [{ position: 0, text: "Unapproved zebra content." }]);
    expect((await q("select * from public.match_source_chunks('zebra', null, 5)")).rows).toEqual([]);
    await approve(proposed, owner);
    expect((await q("select * from public.match_source_chunks('zebra', null, 5)")).rows).toHaveLength(1);
  });

  it("every claim keeps its citation or is marked as having none; lessons cite approved sources only; nothing is attorney-approved", async () => {
    const s = await source("open");
    await expect(q(`insert into public.source_claims (source_id, claim, citation_status) values (null, 'x', 'cited')`)).rejects.toThrow(/source_claims_citation/);
    await expect(claim(null, "An uncited claim")).resolves.toBeDefined();
    await expect(claim(s, "This is attorney-approved advice")).rejects.toThrow(/source_claims_not_attorney/);
    const other = await source("open");
    await chunks(other, [{ position: 0, text: "Some text." }]);
    const chunk = (await q("select id from public.source_chunks where source_id = $1", [other])).rows[0].id;
    await expect(q("insert into public.source_claims (source_id, chunk_id, claim) values ($1, $2, 'mismatch')", [s, chunk])).rejects.toThrow(/isn't from the cited source/);
  });

  it("a conflict is between two approved sources; one open per pair; the decision follows one of the two, resolves it, and can't be edited", async () => {
    const [a, b, unapproved] = [await source("open"), await source("open"), await source("open")];
    await approve(a, reviewer);
    await approve(b, owner);
    const ca = await claim(a, "Reply within 5 minutes.");
    const cb = await claim(b, "Reply within 1 hour.");
    const cu = await claim(unapproved, "Reply within a day.");
    const conflict = (x: string, y: string) => q(`insert into public.source_conflicts (claim_a_id, claim_b_id, reasons) values ($1, $2, '{"timing"}') returning id`, [x, y]);
    await expect(conflict(ca, cu)).rejects.toThrow(/two different approved sources/);
    const id = (await conflict(ca, cb)).rows[0].id;
    await expect(conflict(cb, ca)).rejects.toThrow(/source_conflicts_one_open_pair/);
    const decide = (chosen: string, rationale = "Primary research with a larger sample.") => q(
      `insert into public.authority_decisions (source_conflict_id, version, chosen_claim_id, decision, rationale, decided_by_account_id)
       values ($1, 1, $2, 'Follow source A', $3, $4) returning id`, [id, chosen, rationale, reviewer]);
    await expect(decide(cu)).rejects.toThrow(/one of the two/);
    await expect(decide(ca, "This is attorney approved")).rejects.toThrow(/authority_decisions_not_attorney/);
    const d = (await decide(ca)).rows[0].id;
    expect((await q("select status from public.source_conflicts where id = $1", [id])).rows[0].status).toBe("resolved");
    await expect(q("update public.authority_decisions set rationale = 'changed' where id = $1", [d])).rejects.toThrow(/insert-only/);
  });

  it("keeps the new tables and functions away from the Data API's browser roles", async () => {
    const { rows } = await q(`select has_table_privilege('authenticated', 'public.source_chunks', 'select') as c,
      has_table_privilege('anon', 'public.ai_calls', 'select') as a,
      has_function_privilege('authenticated', 'public.match_source_chunks(text, text, integer)', 'execute') as m,
      has_function_privilege('anon', 'public.put_source_chunks(uuid, jsonb)', 'execute') as p,
      has_function_privilege('service_role', 'public.match_source_chunks(text, text, integer)', 'execute') as s`);
    expect(rows[0]).toEqual({ c: false, a: false, m: false, p: false, s: true });
  });

  it("refuses L1 on a database without B4", async () => {
    const early = await createTestDb({ migrate: false });
    try {
      for (const f of migrationFiles().filter((f) => f < "0011")) await early.client.query(readSql(`${MIGRATIONS_DIR}/${f}`));
      await expect(early.client.query(readSql("db/apply/L1.sql"))).rejects.toThrow(/apply B4 \(0011\) first/);
    } finally {
      await early.client.query("rollback").catch(() => {});
      await early.drop();
    }
  });
});
