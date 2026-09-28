import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb, type TestDb } from "./helpers";

let db: TestDb;
const row: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  const acc = await db.client.query(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
                                     values ('user_a', 'a@example.com', true, 'learner', now()) returning id`);
  const doc = await db.client.query(`insert into public.legal_document_versions (document_key, title, version)
                                     values ('general_terms', 'General Terms', 'v0.1') returning id`);
  // Inserts go in as service_role, the way the API writes.
  await db.client.query("set role service_role");
  row.consent_records = (await db.client.query(
    `insert into public.consent_records (account_id, actor_account_id, relation, legal_document_version_id, status, method)
     values ($1, $1, 'self', $2, 'given', 'Checkbox') returning id`, [acc.rows[0].id, doc.rows[0].id])).rows[0].id;
  row.audit_events = (await db.client.query(
    `insert into public.audit_events (actor_label, action) values ('System', 'Test event') returning id`)).rows[0].id;
  await db.client.query("reset role");
});
afterAll(() => db.drop());

describe.each(["audit_events", "consent_records"])("%s is insert-only", (table) => {
  it("accepts INSERT from service_role", () => expect(row[table]).toBeTruthy());

  it.each([
    ["UPDATE", `update public.${table} set updated_at = now()`],
    ["DELETE", `delete from public.${table}`],
    ["TRUNCATE", `truncate public.${table}`],
  ])("refuses %s as service_role", async (_op, sql) => {
    const r = await asRole(db.client, "service_role", null, sql);
    expect(r.error).toMatch(/permission denied|insert-only/);
  });

  it.each([
    ["UPDATE", `update public.${table} set updated_at = now()`],
    ["DELETE", `delete from public.${table}`],
    ["TRUNCATE", `truncate public.${table}`],
  ])("refuses %s as service_role even if the privilege were granted back (the trigger holds on its own)", async (op, sql) => {
    await db.client.query("begin");
    try {
      await db.client.query(`grant ${op.toLowerCase()} on public.${table} to service_role`);
      await db.client.query("set local role service_role");
      await expect(db.client.query(sql)).rejects.toThrow(new RegExp(`${table} is insert-only; ${op} is not allowed`));
    } finally {
      await db.client.query("rollback");
    }
  });

  it.each([
    ["UPDATE", `update public.${table} set updated_at = now()`],
    ["DELETE", `delete from public.${table}`],
    ["TRUNCATE", `truncate public.${table}`],
  ])("refuses %s as the table owner (the SQL Editor's role)", async (op, sql) => {
    const r = await asRole(db.client, "owner", null, sql);
    expect(r.error).toMatch(new RegExp(`insert-only; ${op}`));
  });

  it("has restrictive policies that refuse UPDATE and DELETE", async () => {
    const { rows } = await db.client.query(
      "select cmd, permissive, qual from pg_policies where tablename = $1 order by cmd", [table]);
    expect(rows).toEqual([
      { cmd: "DELETE", permissive: "RESTRICTIVE", qual: "false" },
      { cmd: "UPDATE", permissive: "RESTRICTIVE", qual: "false" },
    ]);
  });

  it("still has its row afterwards", async () => {
    const { rows } = await db.client.query(`select id from public.${table}`);
    expect(rows).toEqual([{ id: row[table] }]);
  });
});
