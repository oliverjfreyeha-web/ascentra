/**
 * The live smoke's service-key fixtures (e2e/smoke/fixtures.ts), against a real database: they only
 * ever touch ascentra-smoke- learners, refuse the Owner, and clean up everything but audit events.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { cleanUp, ownerState, upsertTestLearner } from "../../e2e/smoke/fixtures";
import { createClient } from "@supabase/supabase-js";

let stack: Stack;
const db = () => createClient(stack.url, stack.serviceKey, { auth: { persistSession: false } });
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);

beforeAll(async () => {
  stack = await startStack();
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, clerk_updated_at, two_factor_enabled)
           values ('user_owner', 'owner@example.com', true, 'owner', now(), true)`);
}, 60_000);
afterAll(() => stack?.stop());

describe("smoke fixtures", () => {
  it("refuse the Owner's email and non-test emails", async () => {
    await expect(upsertTestLearner(db(), { id: "user_x", email: "owner@example.com", label: "x" })).rejects.toThrow(/Owner/);
    await expect(upsertTestLearner(db(), { id: "user_x", email: "someone@example.com", label: "x" })).rejects.toThrow(/isn't a smoke test account/);
    await expect(upsertTestLearner(db(), { id: "user_owner", email: "ascentra-smoke-x+clerk_test@example.com", label: "x" })).rejects.toThrow(/isn't a smoke learner/);
    expect((await q("select role, email from public.accounts")).rows).toEqual([{ role: "owner", email: "owner@example.com" }]);
  });

  it("create a marked learner, re-enable it, and clean up all but audit events", async () => {
    const id = await upsertTestLearner(db(), { id: "user_smoke_a", email: "ascentra-smoke-learner-a+clerk_test@example.com", label: "ASCENTRA smoke learner a" });
    expect((await q("select role, status from public.accounts where id = $1", [id])).rows[0]).toEqual({ role: "learner", status: "active" });
    expect((await q("select display_name from public.profiles where account_id = $1", [id])).rows[0].display_name).toBe("TEST ASCENTRA smoke learner a");
    const dev = (await q(`insert into public.trusted_devices (account_id, name, kind, trust_state) values ($1, 'x', 'other', 'trusted') returning id`, [id])).rows[0].id;
    await q(`insert into public.audit_events (actor_label, action, device_id) values ('TEST', 'smoke', $1)`, [dev]);
    await q(`insert into public.sharing_signals (account_id, kind, points, detail) values ($1, 'overlapping_sessions', 1, 'x')`, [id]);
    await cleanUp(db(), { disable: true });
    expect((await q("select status from public.accounts where id = $1", [id])).rows[0].status).toBe("disabled");
    expect((await q("select trust_state from public.trusted_devices where id = $1", [dev])).rows[0].trust_state).toBe("revoked");
    expect((await q("select count(*)::int as n from public.sharing_signals")).rows[0].n).toBe(0);
    expect((await q("select count(*)::int as n from public.audit_events where action = 'smoke'")).rows[0].n).toBe(1);
    await upsertTestLearner(db(), { id: "user_smoke_a", email: "ascentra-smoke-learner-a+clerk_test@example.com", label: "ASCENTRA smoke learner a" });
    expect((await q("select status from public.accounts where id = $1", [id])).rows[0].status).toBe("active");
    const o = await ownerState(db(), new Date(0).toISOString());
    expect(o.owner).toMatchObject({ role: "owner", status: "active" });
    expect((await q("select role, status from public.accounts where role = 'owner'")).rows).toEqual([{ role: "owner", status: "active" }]);
  });
});
