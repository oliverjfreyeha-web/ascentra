import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb, type TestDb } from "./helpers";

let db: TestDb;
const id: Record<string, string> = {};
const run = (sql: string, params: unknown[] = []) => db.client.query(sql, params).then(() => null, (e: Error) => e.message);

beforeAll(async () => {
  db = await createTestDb();
  for (const [key, role] of [["owner", "owner"], ["admin", "admin"], ["learner", "learner"]]) {
    id[key] = (await db.client.query(
      `insert into public.accounts (clerk_user_id, email, email_verified, role, two_factor_enabled, clerk_updated_at)
       values ($1, $2, true, $3, true, now()) returning id`, [`user_${key}`, `${key}@example.com`, role])).rows[0].id;
  }
});
afterAll(() => db.drop());

describe("Owner protections in the database", () => {
  const ops: [string, string][] = [
    ["demote", "update public.accounts set role = 'admin' where role = 'owner'"],
    ["suspend", "update public.accounts set status = 'disabled' where role = 'owner'"],
    ["delete", "delete from public.accounts where role = 'owner'"],
    ["truncate", "truncate public.accounts cascade"],
  ];

  it.each(ops)("refuses to %s the Owner as service_role (the API's role)", async (_op, sql) => {
    const r = await asRole(db.client, "service_role", null, sql);
    // TRUNCATE ... CASCADE is refused even earlier for service_role: it holds no TRUNCATE on the insert-only tables.
    expect(r.error).toMatch(/ASCENTRA: .*(Owner|truncated)|permission denied/);
  });

  it.each(ops)("refuses to %s the Owner as the table owner (the SQL Editor's role)", async (_op, sql) => {
    const r = await asRole(db.client, "owner", null, sql);
    expect(r.error).toMatch(/ASCENTRA: .*(Owner|truncated)/);
  });

  it("refuses promoting anyone to Owner", async () => {
    const r = await asRole(db.client, "service_role", null, "update public.accounts set role = 'owner' where id = $1", [id.learner]);
    expect(r.error).toMatch(/promoted to Owner|accounts_single_owner/);
  });

  it("still lets the Owner's own details update (email, second factor)", async () => {
    const r = await asRole(db.client, "service_role", null, "update public.accounts set email = 'owner2@example.com' where id = $1", [id.owner]);
    expect(r.error).toBeUndefined();
  });

  it("still lets other accounts be disabled", async () => {
    const r = await asRole(db.client, "service_role", null, "update public.accounts set status = 'disabled' where id = $1", [id.learner]);
    expect(r.error).toBeUndefined();
  });
});

describe("role_assignments rules", () => {
  const invite = (email: string, extra = "") =>
    `insert into public.role_assignments (invited_email, role, scope, status, assigned_by_account_id, expires_at${extra ? ", " + extra.split("=")[0] : ""})
     values ('${email}', 'reviewer', '{mkt}', 'invited', '${id.owner}', now() + interval '7 days'${extra ? ", " + extra.split("=")[1] : ""})`;

  it("accepts a well-formed invite", async () => {
    expect(await run(invite("new@example.com"))).toBeNull();
  });

  it("refuses a second open invite for the same email", async () => {
    expect(await run(invite("new@example.com"))).toMatch(/one_open_invite_per_email/);
  });

  it("refuses an invite without an expiry, or with a mixed-case email", async () => {
    expect(await run(`insert into public.role_assignments (invited_email, role, status, assigned_by_account_id)
                      values ('x@example.com', 'support', 'invited', $1)`, [id.owner])).toMatch(/role_assignments_invite_check/);
    expect(await run(invite("Mixed@Example.com"))).toMatch(/email_lowercase/);
  });

  it.each(["owner", "superAdmin", "admin", "learner"])("refuses the role value %s", async (role) => {
    expect(await run(`insert into public.role_assignments (invited_email, role, status, assigned_by_account_id, expires_at)
                      values ('r@example.com', $1, 'invited', $2, now() + interval '1 day')`, [role, id.owner])).toMatch(/role_assignments_role_check/);
  });

  it("refuses assigning the Owner Academy", async () => {
    expect(await run(`insert into public.role_assignments (invited_email, role, scope, status, assigned_by_account_id, expires_at)
                      values ('g@example.com', 'course_admin', '{mkt,gsa}', 'invited', $1, now() + interval '1 day')`, [id.owner]))
      .toMatch(/no_owner_academy/);
  });

  it("only gives role assignments to admin accounts", async () => {
    expect(await run(`insert into public.role_assignments (account_id, role, status, assigned_by_account_id)
                      values ($1, 'support', 'active', $2)`, [id.learner, id.owner])).toMatch(/only for admin accounts/);
    expect(await run(`insert into public.role_assignments (account_id, role, status, assigned_by_account_id)
                      values ($1, 'support', 'active', $2)`, [id.admin, id.owner])).toBeNull();
  });

  it("allows one live role per admin", async () => {
    expect(await run(`insert into public.role_assignments (account_id, role, status, assigned_by_account_id)
                      values ($1, 'reviewer', 'active', $2)`, [id.admin, id.owner])).toMatch(/one_live_per_account/);
  });

  it("keeps role_assignments closed to signed-in callers", async () => {
    const r = await asRole(db.client, "authenticated", { sub: "user_admin", role: "authenticated" }, "select * from public.role_assignments");
    expect(r.error).toMatch(/permission denied/);
  });
});
