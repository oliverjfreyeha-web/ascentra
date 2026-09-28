import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb, type TestDb } from "./helpers";

let db: TestDb;

const insert = (client: pg.Client, action: string, extra: Record<string, unknown> = {}) =>
  client.query(
    `insert into public.audit_events (actor_label, action, context, result, status, reason, request_id, seq, prev_hash, row_hash)
     values ('Owner (Owner)', $1, 'test', 'completed', 'Recorded', $2, $3, $4, $5, $6) returning seq, prev_hash, row_hash`,
    [action, extra.reason ?? null, extra.request_id ?? null, extra.seq ?? null, extra.prev_hash ?? null, extra.row_hash ?? null],
  );
const verify = async () => (await db.client.query("select * from public.audit_verify_chain()")).rows[0];
/** Test-only tampering: the table owner turns the insert-only trigger off, edits, and turns it back on. */
const tamper = async (sql: string) => {
  await db.client.query("alter table public.audit_events disable trigger reject_update_delete");
  try {
    await db.client.query(sql);
  } finally {
    await db.client.query("alter table public.audit_events enable trigger reject_update_delete");
  }
};

beforeAll(async () => {
  db = await createTestDb();
  await db.client.query("set role service_role");
  for (let i = 1; i <= 5; i++) await insert(db.client, `action.${i}`, { reason: `reason ${i}` });
  await db.client.query("reset role");
});
afterAll(() => db.drop());

describe("the audit chain", () => {
  it("numbers rows 1..n and links each to the previous row's hash", async () => {
    const { rows } = await db.client.query("select seq, prev_hash, row_hash from public.audit_events order by seq");
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0].prev_hash).toBe("0".repeat(64));
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].row_hash);
    expect(new Set(rows.map((r) => r.row_hash)).size).toBe(5);
  });

  it("verifies as intact, reporting the head", async () => {
    const r = await verify();
    const head = (await db.client.query("select row_hash from public.audit_events where seq = 5")).rows[0].row_hash;
    expect(r).toMatchObject({ ok: true, checked: "5", broken_at_seq: null, head_seq: "5", head_hash: head });
  });

  it("ignores any seq or hashes a writer tries to supply", async () => {
    const r = (await insert(db.client, "action.forged", { seq: 999, prev_hash: "f".repeat(64), row_hash: "e".repeat(64) })).rows[0];
    expect(Number(r.seq)).toBe(6);
    expect(r.prev_hash).not.toBe("f".repeat(64));
    expect((await verify()).ok).toBe(true);
  });

  it("stays intact under concurrent writers", async () => {
    const clients = await Promise.all([0, 1, 2, 3].map(async () => {
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      return c;
    }));
    try {
      await Promise.all(clients.flatMap((c, i) => [0, 1, 2, 3, 4].map((j) => insert(c, `concurrent.${i}.${j}`))));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
    expect(await verify()).toMatchObject({ ok: true, checked: "26" });
  });
});

describe("the insert-only rules still hold with the chain", () => {
  it.each([
    ["UPDATE", "update public.audit_events set reason = 'edited' where seq = 2"],
    ["DELETE", "delete from public.audit_events where seq = 2"],
    ["TRUNCATE", "truncate public.audit_events"],
  ])("%s fails as service_role", async (_op, sql) => {
    expect((await asRole(db.client, "service_role", null, sql)).error).toMatch(/permission denied|insert-only/);
  });

  it.each([
    ["UPDATE", "update public.audit_events set reason = 'edited' where seq = 2"],
    ["DELETE", "delete from public.audit_events where seq = 2"],
  ])("%s fails as the table owner too (the trigger)", async (_op, sql) => {
    expect((await asRole(db.client, "owner", null, sql)).error).toMatch(/insert-only/);
  });

  it("lets only the service role run the verification", async () => {
    expect((await asRole(db.client, "service_role", null, "select ok from public.audit_verify_chain()")).rows).toEqual([{ ok: true }]);
    for (const role of ["anon", "authenticated"] as const) {
      expect((await asRole(db.client, role, null, "select * from public.audit_verify_chain()")).error, role).toMatch(/permission denied/);
    }
  });
});

describe("tampering is reported", () => {
  it("reports a row altered by hand, at that row", async () => {
    await tamper("update public.audit_events set reason = 'nothing to see here' where seq = 3");
    expect(await verify()).toMatchObject({ ok: false, broken_at_seq: "3", problem: "Row 3 was changed after it was written (hash differs)." });
    await tamper("update public.audit_events set reason = 'reason 3' where seq = 3");
    expect((await verify()).ok).toBe(true);
  });

  it("reports a row whose hash was recomputed to match the edit: the next row no longer follows", async () => {
    await tamper(`update public.audit_events set reason = 'rewritten' where seq = 4;
                  update public.audit_events e set row_hash = private.audit_row_hash(e) where seq = 4`);
    expect(await verify()).toMatchObject({ ok: false, broken_at_seq: "5", problem: expect.stringMatching(/does not follow row 4/) });
  });

  it("reports a deleted row as missing", async () => {
    await tamper("delete from public.audit_events where seq = 2");
    expect(await verify()).toMatchObject({ ok: false, broken_at_seq: "3", problem: "Row 2 is missing (found 3 next)." });
  });
});
