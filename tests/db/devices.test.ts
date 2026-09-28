/**
 * F6 in the database: the device-slot claim (limit, replacement, concurrency), who may call it, the
 * Owner guard on Limit and Suspend, "only Notice and Verify are automatic", one open appeal, one open
 * session per Clerk session, and the new tables' deny-all.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, clerkClaims, createTestDb, type TestDb } from "./helpers";

let db: TestDb;
let owner: string;
let learner: string;
let support: string;

const hash = (n: number | string) => String(n).padStart(64, "0").replace(/[^0-9a-f]/g, "a");
const claim = (client: pg.Client | pg.PoolClient, account: string, key: string, replace: string | null = null, limit = 3) =>
  client.query(
    "select * from public.claim_device_slot($1, $2, 'Chrome on Windows', 'desktop', 'WA, US', $3, $4)",
    [account, key, limit, replace],
  ).then((r) => r.rows[0] as { outcome: string; device_id: string | null; replaced_id: string | null });
const trusted = async (account: string) =>
  (await db.client.query("select count(*)::int as n from public.trusted_devices where account_id = $1 and trust_state = 'trusted'", [account])).rows[0].n;

beforeAll(async () => {
  db = await createTestDb();
  const mk = async (email: string, role: string) =>
    (await db.client.query(
      `insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
       values ($1, $2, true, $3, now(), true) returning id`, [`user_${email}`, email, role])).rows[0].id as string;
  owner = await mk("owner@example.com", "owner");
  learner = await mk("learner@example.com", "learner");
  support = await mk("support@example.com", "admin");
});
afterAll(() => db.drop());

describe("claim_device_slot", () => {
  it("registers up to the limit, then refuses a fourth device and changes nothing", async () => {
    for (let i = 1; i <= 3; i++) expect((await claim(db.client, learner, hash(i))).outcome).toBe("registered");
    expect(await claim(db.client, learner, hash(4))).toEqual({ outcome: "full", device_id: null, replaced_id: null });
    expect(await trusted(learner)).toBe(3);
  });

  it("recognises a device it already trusts", async () => {
    expect((await claim(db.client, learner, hash(2))).outcome).toBe("existing");
    expect(await trusted(learner)).toBe(3);
  });

  it("lets the fourth device replace one the person picks, keeping the count at the limit", async () => {
    const first = (await db.client.query("select id from public.trusted_devices where account_id = $1 and device_key_hash = $2", [learner, hash(1)])).rows[0].id;
    const r = await claim(db.client, learner, hash(4), first);
    expect(r.outcome).toBe("replaced");
    expect(r.replaced_id).toBe(first);
    expect(await trusted(learner)).toBe(3);
    const old = (await db.client.query("select trust_state, revoked_reason, replaced_by_id from public.trusted_devices where id = $1", [first])).rows[0];
    expect(old).toEqual({ trust_state: "revoked", revoked_reason: "replaced", replaced_by_id: r.device_id });
  });

  it("refuses to replace a device that isn't this account's", async () => {
    const other = (await claim(db.client, owner, hash("o1"))).device_id;
    expect((await claim(db.client, learner, hash(5), other)).outcome).toBe("not_found");
    expect(await trusted(learner)).toBe(3);
  });

  it("never goes past the limit when ten new devices sign in at once", async () => {
    const acct = (await db.client.query(
      `insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at) values ('user_race', 'race@example.com', true, 'learner', now()) returning id`)).rows[0].id;
    const clients = await Promise.all(Array.from({ length: 10 }, async () => {
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      await c.query("set role service_role");
      return c;
    }));
    try {
      const results = await Promise.all(clients.map((c, i) => claim(c, acct, hash(`r${i}`))));
      expect(results.filter((r) => r.outcome === "registered")).toHaveLength(3);
      expect(results.filter((r) => r.outcome === "full")).toHaveLength(7);
      expect(await trusted(acct)).toBe(3);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("can be called by the service role only", async () => {
    const sql = `select * from public.claim_device_slot('${learner}', '${hash(9)}', 'x', 'other', null, 3, null)`;
    expect((await asRole(db.client, "service_role", null, sql)).error).toBeUndefined();
    expect((await asRole(db.client, "anon", null, sql)).error).toMatch(/permission denied/);
    expect((await asRole(db.client, "authenticated", clerkClaims("user_learner@example.com"), sql)).error).toMatch(/permission denied/);
  });
});

describe("the graduated steps", () => {
  const step = (account: string, s: string, automatic: boolean, by: string | null, limitUntil: string | null = null) =>
    db.client.query(
      "insert into public.enforcement_steps (account_id, step, automatic, applied_by_account_id, reason, limit_until) values ($1, $2, $3, $4, 'Reviewed the session history', $5) returning id",
      [account, s, automatic, by, limitUntil],
    );

  it("only Notice and Verify can be automatic", async () => {
    await expect(step(learner, "notice", true, null)).resolves.toBeDefined();
    await expect(step(learner, "verify", true, null)).resolves.toBeDefined();
    await expect(step(learner, "limit", true, null, "2030-01-01")).rejects.toThrow(/check constraint/);
    await expect(step(learner, "suspend", true, null)).rejects.toThrow(/check constraint/);
  });

  it("Limit and Suspend always name the person who applied them", async () => {
    await expect(step(learner, "suspend", false, null)).rejects.toThrow(/check constraint/);
    await expect(step(learner, "limit", false, support, "2030-01-01")).resolves.toBeDefined();
    await expect(step(learner, "suspend", false, support)).resolves.toBeDefined();
  });

  it("the Owner is never limited or suspended, by anyone, even as the table owner", async () => {
    await expect(step(owner, "limit", false, support, "2030-01-01")).rejects.toThrow(/Owner can't be limited or suspended/);
    await expect(step(owner, "suspend", false, support)).rejects.toThrow(/Owner can't be limited or suspended/);
    await expect(step(owner, "suspend", false, owner)).rejects.toThrow(/Owner can't be limited or suspended/);
    const n = await step(owner, "notice", true, null);
    await expect(db.client.query("update public.enforcement_steps set step = 'suspend' where id = $1", [n.rows[0].id])).rejects.toThrow(/Owner can't/);
    await expect(asRole(db.client, "service_role", null,
      `insert into public.enforcement_steps (account_id, step, automatic, applied_by_account_id, reason) values ('${owner}', 'suspend', false, '${support}', 'Reviewed history')`,
    )).resolves.toMatchObject({ error: expect.stringMatching(/Owner can't/) });
  });

  it("allows one open appeal per account, and it reaches the review queue", async () => {
    const s = (await db.client.query("select id from public.enforcement_steps where account_id = $1 order by created_at desc limit 1", [learner])).rows[0].id;
    const appeal = (text: string) => db.client.query(
      "insert into public.appeals (account_id, enforcement_step_id, step, text) values ($1, $2, 'suspend', $3) returning reference", [learner, s, text]);
    const first = await appeal("I switched phones and signed in from a hotel on a trip.");
    expect(first.rows[0].reference).toMatch(/^AP-\d+$/);
    await expect(appeal("A second appeal while the first is open.")).rejects.toThrow(/appeals_one_open/);
    const queue = await db.client.query("select reference from public.appeals where status = 'under_review' order by created_at");
    expect(queue.rows.map((r) => r.reference)).toContain(first.rows[0].reference);
    await expect(appeal("too short")).rejects.toThrow();
  });
});

describe("sessions", () => {
  it("has at most one open session row per Clerk session, and a complete row", async () => {
    const dev = (await db.client.query("select id from public.trusted_devices where account_id = $1 and trust_state = 'trusted' limit 1", [learner])).rows[0].id;
    const open = () => db.client.query(
      `insert into public.session_events (account_id, trusted_device_id, event_type, description, clerk_session_id, state, started_at, activated_at, last_heartbeat_at)
       values ($1, $2, 'session', 'Session', 'sess_1', 'active', now(), now(), now())`, [learner, dev]);
    await open();
    await expect(open()).rejects.toThrow(/session_events_one_open/);
    await expect(db.client.query(
      `insert into public.session_events (account_id, event_type, description, state) values ($1, 'session', 'Session', 'active')`, [learner],
    )).rejects.toThrow(/session_rows_complete/);
  });

  it("stores no IP address anywhere", async () => {
    const { rows } = await db.client.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (column_name ~* '(^|_)ip(_|$)' or column_name ilike '%ip_addr%' or data_type = 'inet')`);
    expect(rows).toEqual([]);
  });
});

describe("the new tables", () => {
  it.each(["sharing_signals", "sharing_flags", "enforcement_steps", "appeals"])("%s is deny-all to anon and authenticated", async (t) => {
    expect((await asRole(db.client, "anon", null, `select * from public.${t}`)).error).toMatch(/permission denied/);
    expect((await asRole(db.client, "authenticated", clerkClaims("user_learner@example.com"), `select * from public.${t}`)).error).toMatch(/permission denied/);
    expect((await asRole(db.client, "service_role", null, `select count(*) from public.${t}`)).error).toBeUndefined();
  });
});
