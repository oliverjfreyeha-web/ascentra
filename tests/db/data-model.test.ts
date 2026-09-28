import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
let owner: string;
let academy: string;

// Each statement runs on its own (autocommit), so a failure doesn't affect the next one.
const fails = (sql: string, params: unknown[] = []) =>
  db.client.query(sql, params).then(
    () => null,
    (e: Error) => e.message,
  );

beforeAll(async () => {
  db = await createTestDb();
  owner = (await db.client.query(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at)
    values ('user_o', 'o@example.com', true, 'owner', now()) returning id`)).rows[0].id;
  academy = (await db.client.query(`insert into public.academies (slug, name) values ('mkt', 'Home Services') returning id`)).rows[0].id;
});
afterAll(() => db.drop());

describe("accounts", () => {
  it("has is_minor, false by default", async () => {
    const { rows } = await db.client.query("select is_minor from public.accounts where id = $1", [owner]);
    expect(rows[0].is_minor).toBe(false);
  });

  it("allows a minor only as a learner", async () => {
    expect(await fails(`insert into public.accounts (clerk_user_id, email, role, is_minor, clerk_updated_at)
                        values ('user_t', 't@example.com', 'learner', true, now())`)).toBeNull();
    expect(await fails(`insert into public.accounts (clerk_user_id, email, role, is_minor, clerk_updated_at)
                        values ('user_t2', 't2@example.com', 'admin', true, now())`)).toMatch(/accounts_minor_role_check/);
  });

  it("still allows only one Owner", async () => {
    expect(await fails(`insert into public.accounts (clerk_user_id, email, role, clerk_updated_at)
                        values ('user_o2', 'o2@example.com', 'owner', now())`)).toMatch(/accounts_single_owner/);
  });
});

describe("courses carry the prototype's version states", () => {
  it.each(["draft", "review", "published", "archived"])("accepts %s", async (status) => {
    const v = { draft: 1, review: 2, published: 3, archived: 4 }[status];
    expect(await fails("insert into public.courses (academy_id, version, status) values ($1, $2, $3)", [academy, v, status])).toBeNull();
  });

  it("accepts restored, which must name an earlier version", async () => {
    expect(await fails(`insert into public.courses (academy_id, version, status, restored_from_version)
                        values ($1, 5, 'restored', 3)`, [academy])).toBeNull();
    expect(await fails(`insert into public.courses (academy_id, version, status) values ($1, 6, 'restored')`, [academy]))
      .toMatch(/check constraint/);
  });

  it("rejects any other state", async () => {
    expect(await fails("insert into public.courses (academy_id, version, status) values ($1, 7, 'live')", [academy]))
      .toMatch(/courses_status_check/);
  });
});

describe("connection_statuses", () => {
  it("cannot say Connected without evidence", async () => {
    expect(await fails("insert into public.connection_statuses (service, status) values ('clerk', 'connected')"))
      .toMatch(/check constraint/);
    expect(await fails(`insert into public.connection_statuses (service, status, evidence, checked_at)
                        values ('clerk', 'connected', 'GET /v1/jwks returned 200', now())`)).toBeNull();
  });
});

describe("retention_class", () => {
  it("only accepts the defined classes, and has no durations", async () => {
    expect(await fails("update public.academies set retention_class = 'forever'")).toMatch(/retention_class/);
    const { rows } = await db.client.query(
      "select distinct retention_class from public.accounts union select distinct retention_class from public.academies");
    expect(rows.map((r) => r.retention_class).sort()).toEqual(["account", "content"]);
  });
});

describe("updated_at", () => {
  it("moves forward on update", async () => {
    const before = (await db.client.query("select updated_at from public.academies where id = $1", [academy])).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 10));
    await db.client.query("update public.academies set name = 'Home Services Growth' where id = $1", [academy]);
    const after = (await db.client.query("select updated_at from public.academies where id = $1", [academy])).rows[0].updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
