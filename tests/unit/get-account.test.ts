import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth, reverificationErrorResponse: vi.fn(), clerkClient: vi.fn() }));
const store = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, assignment: null as Record<string, unknown> | null }));
vi.mock("@/lib/accounts", () => ({
  findAccountByClerkId: vi.fn(async (id: string) => (store.row?.clerk_user_id === id ? store.row : null)),
  findLiveAssignment: vi.fn(async () => store.assignment),
  findProfile: vi.fn(async () => ({ account_id: "acc_1", display_name: "Olive Owner", image_url: null })),
}));

import { getAccount } from "@/lib/auth";

const has = vi.fn(() => true);
const signedIn = { isAuthenticated: true, userId: "user_1", sessionId: "sess_1", has };
const signedOut = { isAuthenticated: false, userId: null, sessionId: null };
const owner = {
  id: "acc_1", clerk_user_id: "user_1", email: "owner@example.com", email_verified: true, role: "owner",
  status: "active", password_enabled: true, two_factor_enabled: true,
};
const admin = { ...owner, email: "morgan@example.com", role: "admin" };
const activeCourseAdmin = { id: "ra_1", role: "course_admin", status: "active", scope: ["mkt", "creator"] };

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(signedIn);
  store.row = { ...owner };
  store.assignment = null;
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("getAccount", () => {
  it("returns the Owner for a valid session, verified email, second factor and matching OWNER_EMAIL", async () => {
    expect(await getAccount()).toEqual({
      id: "acc_1", email: "owner@example.com", role: "owner", displayName: "Olive Owner",
      roleKey: "owner", adminRole: null, assignedCourses: [], isMinor: false,
    });
  });

  it("returns nothing with no session (missing, expired and pending sessions all look signed out)", async () => {
    auth.mockResolvedValue(signedOut);
    expect(await getAccount()).toBeNull();
  });

  it("returns nothing when session verification throws", async () => {
    auth.mockRejectedValue(new Error("token expired"));
    expect(await getAccount()).toBeNull();
  });

  it("returns nothing for a Clerk user with no Account (not the Owner, not invited)", async () => {
    auth.mockResolvedValue({ ...signedIn, userId: "user_stranger" });
    expect(await getAccount()).toBeNull();
  });

  it("refuses an unverified email", async () => {
    store.row = { ...owner, email_verified: false };
    expect(await getAccount()).toBeNull();
  });

  // R1: the second factor is optional for learners, and still required for the Owner, admins and Guardians.
  it("accepts a learner with a password and no second factor (adult or teen)", async () => {
    store.row = { ...owner, email: "sam@example.com", role: "learner", two_factor_enabled: false, is_minor: false };
    expect((await getAccount())?.roleKey).toBe("learner");
    store.row = { ...owner, email: "teen@example.com", role: "learner", two_factor_enabled: false, is_minor: true };
    expect(await getAccount()).toMatchObject({ roleKey: "learner", isMinor: true });
  });

  it("still refuses the Owner, an admin and a Guardian with a password and no second factor", async () => {
    store.row = { ...owner, two_factor_enabled: false };
    expect(await getAccount()).toBeNull();
    store.row = { ...admin, two_factor_enabled: false };
    store.assignment = activeCourseAdmin;
    expect(await getAccount()).toBeNull();
    store.assignment = null;
    store.row = { ...owner, email: "pat@example.com", role: "guardian", two_factor_enabled: false };
    expect(await getAccount()).toBeNull();
    // With one, the Guardian and the admin are fine.
    store.row = { ...owner, email: "pat@example.com", role: "guardian", two_factor_enabled: true };
    expect((await getAccount())?.roleKey).toBe("guardian");
    store.row = { ...admin };
    store.assignment = activeCourseAdmin;
    expect((await getAccount())?.roleKey).toBe("courseAdmin");
  });

  it("refuses a passkey-only Guardian without a second factor", async () => {
    store.row = { ...owner, email: "pat@example.com", role: "guardian", password_enabled: false, two_factor_enabled: false };
    expect(await getAccount()).toBeNull();
  });

  it("accepts a passkey-only learner", async () => {
    store.row = { ...owner, role: "learner", password_enabled: false, two_factor_enabled: false };
    expect((await getAccount())?.roleKey).toBe("learner");
  });

  it("refuses the Owner without a second factor, even passkey-only", async () => {
    store.row = { ...owner, password_enabled: false, two_factor_enabled: false };
    expect(await getAccount()).toBeNull();
  });

  it("refuses an Owner row whose email isn't OWNER_EMAIL (an edited database can't make an Owner)", async () => {
    store.row = { ...owner, email: "someone-else@example.com" };
    expect(await getAccount()).toBeNull();
  });

  it("refuses a disabled account", async () => {
    store.row = { ...owner, role: "learner", status: "disabled" };
    expect(await getAccount()).toBeNull();
  });

  it("gives an admin their role and assigned courses from the active role assignment", async () => {
    store.row = { ...admin };
    store.assignment = activeCourseAdmin;
    expect(await getAccount()).toMatchObject({ role: "admin", roleKey: "courseAdmin", adminRole: "courseAdmin", assignedCourses: ["mkt", "creator"] });
  });

  it("refuses an admin without a second factor", async () => {
    store.row = { ...admin, password_enabled: false, two_factor_enabled: false };
    store.assignment = activeCourseAdmin;
    expect(await getAccount()).toBeNull();
  });

  it("refuses an admin whose invite is only claimed (not yet active)", async () => {
    store.row = { ...admin };
    store.assignment = { ...activeCourseAdmin, status: "claimed" };
    expect(await getAccount()).toBeNull();
  });

  it.each(["owner", "superadmin", "admin", "", null])("refuses an admin whose stored role is %j (forged or unknown)", async (role) => {
    store.row = { ...admin };
    store.assignment = { ...activeCourseAdmin, role };
    expect(await getAccount()).toBeNull();
  });
});
