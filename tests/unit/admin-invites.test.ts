import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";
import { clerkUser } from "../fixtures/clerk-user";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const recordAuditEvent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));

import { checkInviteActivation, checkInviteClaim, parseInviteRequest, parseRoleChange, type InviteRow } from "@/lib/admin-rules";
import { syncClerkUser } from "@/lib/accounts";

const NOW = new Date("2026-10-01T12:00:00Z");
const OWNER_EMAIL = "owner@example.com";
const invite = (over: Partial<InviteRow> = {}): InviteRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  status: "invited",
  invited_email: "morgan@example.com",
  expires_at: "2026-10-05T12:00:00Z",
  account_id: null,
  claimed_by_clerk_user_id: null,
  ...over,
});
const morgan = { clerkUserId: "user_morgan", email: "morgan@example.com", emailVerified: true };

describe("checkInviteClaim", () => {
  it("accepts the invited, verified email before expiry", () => {
    expect(checkInviteClaim(invite(), morgan, NOW)).toEqual({ ok: true, value: null });
  });

  it.each<[string, InviteRow | null, typeof morgan, RegExp]>([
    ["an expired invite", invite({ expires_at: "2026-09-30T12:00:00Z" }), morgan, /expired/],
    ["an invite expiring this instant", invite({ expires_at: NOW.toISOString() }), morgan, /expired/],
    ["a reused invite (already claimed)", invite({ status: "claimed", claimed_by_clerk_user_id: "user_other" }), morgan, /already been used/],
    ["a reused invite (already active)", invite({ status: "active" }), morgan, /already been used/],
    ["a revoked invite", invite({ status: "revoked" }), morgan, /revoked/],
    ["an invite accepted by the wrong email", invite(), { ...morgan, email: "mallory@example.com" }, /different email/],
    ["an unverified email", invite(), { ...morgan, emailVerified: false }, /isn't verified/],
    ["no invite at all", null, morgan, /No such invite/],
  ])("refuses %s", (_name, row, who, reason) => {
    const r = checkInviteClaim(row, who, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(reason);
  });

  it("matches email case-insensitively", () => {
    expect(checkInviteClaim(invite(), { ...morgan, email: "Morgan@Example.com" }, NOW).ok).toBe(true);
  });
});

describe("checkInviteActivation (accepting requires a second factor)", () => {
  const claimed = invite({ status: "claimed", account_id: "acc_1", claimed_by_clerk_user_id: "user_morgan" });
  it("activates with a second factor before expiry", () => expect(checkInviteActivation(claimed, true, NOW).ok).toBe(true));
  it("refuses without a second factor", () => expect(checkInviteActivation(claimed, false, NOW).ok).toBe(false));
  it("refuses after expiry", () =>
    expect(checkInviteActivation({ ...claimed, expires_at: "2026-09-01T00:00:00Z" }, true, NOW).ok).toBe(false));
});

describe("role values are only ever one of ADMIN_ROLES", () => {
  it.each(["owner", "Owner", "superadmin", "admin", "learner", "", "courseAdmin "])('refuses role %j', (role) => {
    const r = parseRoleChange({ role, courses: [] });
    expect(r.ok).toBe(false);
    expect(parseInviteRequest({ email: "a@example.com", role, courses: [] }).ok).toBe(false);
  });

  it("names the allowed roles when refusing \"owner\"", () => {
    const r = parseRoleChange({ role: "owner" });
    expect(!r.ok && r.reason).toBe('"owner" isn\'t an administrator role. Choose one of: Super Admin, Course Admin, Learning Reviewer, Support Admin.');
  });

  it("refuses assigning the Owner Academy, and course rules per role", () => {
    expect(parseRoleChange({ role: "courseAdmin", courses: ["gsa"] }).ok).toBe(false);
    expect(parseRoleChange({ role: "courseAdmin", courses: [] }).ok).toBe(false);
    expect(parseRoleChange({ role: "superAdmin", courses: ["mkt"] }).ok).toBe(false);
    expect(parseRoleChange({ role: "support", courses: ["mkt"] }).ok).toBe(false);
    expect(parseRoleChange({ role: "reviewer", courses: ["mkt", "mkt"] })).toEqual({ ok: true, value: { role: "reviewer", courses: ["mkt"] } });
  });

  it("refuses unknown fields", () => {
    expect(parseRoleChange({ role: "support", courses: [], status: "owner" }).ok).toBe(false);
  });
});

describe("invite sign-up through the Clerk webhook", () => {
  let db: ReturnType<typeof createFakeDb>;
  const inviteRow = (over: Record<string, unknown> = {}) => ({
    id: "11111111-1111-4111-8111-111111111111", status: "invited", invited_email: "morgan@example.com",
    expires_at: "2026-10-05T12:00:00Z", role: "course_admin", scope: ["mkt"], account_id: null,
    claimed_by_clerk_user_id: null, assigned_by_account_id: "acc_owner", ...over,
  });
  const signUp = (over: Parameters<typeof clerkUser>[0] = {}, metadata: Record<string, unknown> = { ascentra_invite_id: inviteRow().id }) => {
    const u = clerkUser({ id: "user_morgan", email: "morgan@example.com", ...over });
    (u as unknown as { public_metadata: unknown }).public_metadata = metadata;
    return u;
  };

  beforeEach(() => {
    db = createFakeDb({ accounts: [{ id: "acc_owner", clerk_user_id: "user_owner", role: "owner", status: "active" }] });
    fake.db = db;
    recordAuditEvent.mockClear();
  });

  it("claims the invite: an admin account, no active role until a second factor", async () => {
    db.data.role_assignments.push(inviteRow());
    expect(await syncClerkUser(signUp(), OWNER_EMAIL, NOW)).toBe("admin_claimed");
    const acc = db.data.accounts.find((a) => a.clerk_user_id === "user_morgan")!;
    expect(acc.role).toBe("admin");
    expect(db.data.role_assignments[0]).toMatchObject({ status: "claimed", account_id: acc.id, claimed_by_clerk_user_id: "user_morgan" });

    // They add an authenticator app: user.updated arrives with two_factor_enabled.
    expect(await syncClerkUser(signUp({ twoFactorEnabled: true, updatedAt: 1_700_000_100_000 }), OWNER_EMAIL, NOW)).toBe("admin_activated");
    expect(db.data.role_assignments[0].status).toBe("active");
  });

  it("activates at once if the new user already has a second factor", async () => {
    db.data.role_assignments.push(inviteRow());
    expect(await syncClerkUser(signUp({ twoFactorEnabled: true }), OWNER_EMAIL, NOW)).toBe("admin_activated");
  });

  it("refuses an expired invite and creates no account", async () => {
    db.data.role_assignments.push(inviteRow({ expires_at: "2026-09-30T00:00:00Z" }));
    expect(await syncClerkUser(signUp(), OWNER_EMAIL, NOW)).toBe("invite_refused");
    expect(db.data.accounts.some((a) => a.clerk_user_id === "user_morgan")).toBe(false);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "admin.invite_refused", detail: expect.stringMatching(/expired/) }));
  });

  it("refuses a reused invite: the second person gets nothing", async () => {
    db.data.role_assignments.push(inviteRow());
    await syncClerkUser(signUp(), OWNER_EMAIL, NOW);
    const second = signUp({ id: "user_second", email: "morgan@example.com" });
    expect(await syncClerkUser(second, OWNER_EMAIL, NOW)).toBe("invite_refused");
    expect(db.data.accounts.some((a) => a.clerk_user_id === "user_second")).toBe(false);
  });

  it("refuses an invite accepted by the wrong email", async () => {
    db.data.role_assignments.push(inviteRow());
    expect(await syncClerkUser(signUp({ email: "mallory@example.com" }), OWNER_EMAIL, NOW)).toBe("invite_refused");
    expect(db.data.role_assignments[0].status).toBe("invited");
  });

  it("refuses a revoked invite", async () => {
    db.data.role_assignments.push(inviteRow({ status: "revoked" }));
    expect(await syncClerkUser(signUp(), OWNER_EMAIL, NOW)).toBe("invite_refused");
  });

  it("doesn't activate a claimed invite after it expires, even with a second factor", async () => {
    db.data.role_assignments.push(inviteRow());
    await syncClerkUser(signUp(), OWNER_EMAIL, NOW);
    const later = new Date("2026-10-06T00:00:00Z");
    await syncClerkUser(signUp({ twoFactorEnabled: true, updatedAt: 1_700_000_100_000 }), OWNER_EMAIL, later);
    expect(db.data.role_assignments[0].status).toBe("claimed");
  });

  it("treats a made-up invite id as no invite", async () => {
    expect(await syncClerkUser(signUp({}, { ascentra_invite_id: "not-a-uuid" }), OWNER_EMAIL, NOW)).toBe("invite_refused");
  });

  it("gives someone without an invite nothing, as before", async () => {
    expect(await syncClerkUser(signUp({}, {}), OWNER_EMAIL, NOW)).toBe("no_account");
  });
});
