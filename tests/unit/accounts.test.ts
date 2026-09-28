import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";
import { clerkUser } from "../fixtures/clerk-user";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));

import { disableClerkUser, identityFromClerkUser, planSync, syncClerkUser, type AccountRow } from "@/lib/accounts";

const OWNER = "owner@example.com";
let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  db = createFakeDb();
  fake.db = db;
});

describe("planSync (who gets an Account)", () => {
  const ctx = { ownerEmail: OWNER, ownerExists: false };

  it("seeds the Owner from a verified OWNER_EMAIL, matching case-insensitively", () => {
    const id = identityFromClerkUser(clerkUser({ email: "Owner@Example.com" }));
    expect(planSync(id, null, { ...ctx, ownerEmail: " OWNER@example.com " }).outcome).toBe("owner_seeded");
  });

  it("refuses an unverified email, even the Owner's", () => {
    const id = identityFromClerkUser(clerkUser({ verified: false }));
    expect(planSync(id, null, ctx).outcome).toBe("no_account");
  });

  it("gives anyone else no Account (sign-up is closed)", () => {
    const id = identityFromClerkUser(clerkUser({ email: "stranger@example.com" }));
    expect(planSync(id, null, ctx).outcome).toBe("no_account");
  });

  it("seeds the Owner only once", () => {
    const id = identityFromClerkUser(clerkUser({ id: "user_2" }));
    expect(planSync(id, null, { ...ctx, ownerExists: true }).outcome).toBe("no_account");
  });

  it("ignores an event older than what is stored", () => {
    const id = identityFromClerkUser(clerkUser({ updatedAt: 1000 }));
    const existing = { clerk_updated_at: new Date(2000).toISOString(), password_last_updated_at: null } as AccountRow;
    expect(planSync(id, existing, ctx).outcome).toBe("stale_ignored");
  });
});

describe("syncClerkUser", () => {
  it("creates the Owner's Account and Profile", async () => {
    expect(await syncClerkUser(clerkUser(), OWNER)).toBe("owner_seeded");
    expect(db.data.accounts).toMatchObject([{ clerk_user_id: "user_1", role: "owner", email: OWNER, email_verified: true }]);
    expect(db.data.profiles).toMatchObject([{ display_name: "Olive Owner" }]);
  });

  it("creates nothing for a stranger", async () => {
    expect(await syncClerkUser(clerkUser({ email: "stranger@example.com" }), OWNER)).toBe("no_account");
    expect(db.data.accounts).toEqual([]);
  });

  it("keeps one Owner when two deliveries race", async () => {
    await syncClerkUser(clerkUser({ id: "user_1" }), OWNER);
    db.data.accounts[0].role = "owner";
    expect(await syncClerkUser(clerkUser({ id: "user_2" }), OWNER)).toBe("no_account");
    expect(db.data.accounts.filter((a) => a.role === "owner")).toHaveLength(1);
  });

  it("writes a real audit event when the Owner's password is set or reset (recovery), which the Owner can see", async () => {
    await syncClerkUser(clerkUser({ passwordEnabled: true, twoFactorEnabled: true, passwordLastUpdatedAt: 1_700_000_000_000 }), OWNER);
    expect(db.data.audit_events).toEqual([]);

    await syncClerkUser(
      clerkUser({ passwordEnabled: true, twoFactorEnabled: true, passwordLastUpdatedAt: 1_700_000_500_000, updatedAt: 1_700_000_500_000 }),
      OWNER,
    );
    expect(db.data.audit_events).toHaveLength(1);
    expect(db.data.audit_events[0]).toMatchObject({
      action: "account.password_changed", actor_label: "System (Clerk webhook)", target_type: "account",
      target_id: db.data.accounts[0].id, target_label: OWNER, result: "completed", status: "Recorded", is_sensitive: true,
    });
  });

  it("doesn't audit a learner's password change", async () => {
    db.data.accounts.push({ id: "acc_l", clerk_user_id: "user_l", role: "learner", status: "active", email: "l@example.com",
      password_last_updated_at: new Date(1_700_000_000_000).toISOString(), clerk_updated_at: new Date(1_700_000_000_000).toISOString() });
    await syncClerkUser(clerkUser({ id: "user_l", email: "l@example.com", passwordEnabled: true, passwordLastUpdatedAt: 1_700_000_500_000, updatedAt: 1_700_000_500_000 }), OWNER);
    expect(db.data.audit_events).toEqual([]);
  });

  it("disables (not deletes) an Account when the Clerk user is deleted", async () => {
    db.data.accounts.push({ id: "acc_learner", clerk_user_id: "user_9", role: "learner", status: "active" });
    await disableClerkUser("user_9");
    expect(db.data.accounts[0].status).toBe("disabled");
    expect(db.data.audit_events).toMatchObject([{ action: "account.disable", result: "completed", new_value: "disabled" }]);
  });

  it("never disables the Owner, even if Clerk reports the Owner deleted", async () => {
    await syncClerkUser(clerkUser(), OWNER);
    await disableClerkUser("user_1");
    expect(db.data.accounts[0].status).toBe("active");
    expect(db.data.audit_events).toMatchObject([{ action: "account.disable", result: "blocked", status: "No change made" }]);
  });
});
