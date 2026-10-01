import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, readSql, type TestDb } from "./helpers";

/**
 * db/ops/create-test-learner.sql: the Owner creates ONE adult test learner by hand, for a Clerk user
 * that already exists. It never creates or changes an admin or the Owner, and it is audited.
 */
const OWNER = { clerk: "user_liveowner0001", email: "owner@example.com" };
const script = (clerk: string, email: string, reason = "B1 live check: a learner account to test billing") =>
  readSql("db/ops/create-test-learner.sql")
    .replace("'user_PASTE_THE_CLERK_USER_ID'::text", `'${clerk}'::text`)
    .replace("'paste.the.email@example.com'::text", `'${email}'::text`)
    .replace("'B1 live check: a learner account to test billing'::text", `'${reason}'::text`);

describe("db/ops/create-test-learner.sql", () => {
  let db: TestDb;
  const q = (sql: string, args: unknown[] = []) => db.client.query(sql, args);
  const run = async (sql: string) => {
    try {
      return await q(sql);
    } catch (e) {
      await q("rollback").catch(() => {});
      throw e;
    }
  };
  const counts = async () => (await q(`select (select count(*) from public.accounts)::int as a, (select count(*) from public.audit_events)::int as e`)).rows[0];

  beforeAll(async () => {
    db = await createTestDb();
    await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled, password_enabled)
             values ($1, $2, true, 'owner', now(), true, true)`, [OWNER.clerk, OWNER.email]);
    await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled, password_enabled)
             values ('user_existingadmin01', 'admin@example.com', true, 'admin', now(), true, true)`);
  });
  afterAll(() => db.drop());
  beforeEach(async () => {
    await q("rollback").catch(() => {});
  });

  it("refuses the untouched template, and changes nothing", async () => {
    const before = await counts();
    await expect(run(readSql("db/ops/create-test-learner.sql"))).rejects.toThrow(/set clerk_user_id/);
    expect(await counts()).toEqual(before);
  });

  it("refuses the Owner, by Clerk id or by email", async () => {
    const before = await counts();
    await expect(run(script(OWNER.clerk, "someone@example.com"))).rejects.toThrow(/that is the Owner/);
    await expect(run(script("user_brandnewuser001", "OWNER@example.com"))).rejects.toThrow(/that is the Owner/);
    expect(await counts()).toEqual(before);
    expect((await q("select role, status from public.accounts where clerk_user_id = $1", [OWNER.clerk])).rows[0]).toEqual({ role: "owner", status: "active" });
  });

  it("never converts an existing account (an admin, for example)", async () => {
    const before = await counts();
    await expect(run(script("user_existingadmin01", "new@example.com"))).rejects.toThrow(/already exists/);
    await expect(run(script("user_brandnewuser001", "admin@example.com"))).rejects.toThrow(/already exists/);
    expect(await counts()).toEqual(before);
    expect((await q("select role from public.accounts where clerk_user_id = 'user_existingadmin01'")).rows[0].role).toBe("admin");
  });

  it("refuses without a reason", async () => {
    await expect(run(script("user_brandnewuser001", "learner@example.com", "  "))).rejects.toThrow(/give a reason/);
  });

  it("creates one adult learner with a profile and one audit event, and the chain still verifies", async () => {
    const before = await counts();
    const res = await run(script("user_testlearner0001", "Test.Learner+clerk_test@example.com"));
    const row = (Array.isArray(res) ? res.at(-2) : res).rows[0];
    expect(row).toMatchObject({ email: "test.learner+clerk_test@example.com", role: "learner", is_minor: false, status: "active", display_name: "TEST Learner" });
    expect(await counts()).toEqual({ a: before.a + 1, e: before.e + 1 });
    const ev = (await q("select * from public.audit_events order by seq desc limit 1")).rows[0];
    expect(ev).toMatchObject({
      action: "accounts.create_test_learner", actor_role: "owner", result: "completed", is_sensitive: true,
      target_id: row.id, new_value: "learner (adult, test)", reason: "B1 live check: a learner account to test billing",
    });
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
    // A second run for the same user changes nothing.
    await expect(run(script("user_testlearner0001", "test.learner+clerk_test@example.com"))).rejects.toThrow(/already exists/);
  });
});
