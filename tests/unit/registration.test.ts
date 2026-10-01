/**
 * B2: the sign-up step and the Guardian invitation, through the real routes (database faked in memory, Clerk
 * mocked), and Support's date-of-birth correction. The database's own age rules are in tests/db/age.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { clerkUser } from "../fixtures/clerk-user";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { isoDate, usToday } from "@/lib/age";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const clerk = vi.hoisted(() => ({
  userId: null as string | null,
  users: {} as Record<string, unknown>,
  deleted: [] as string[],
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: !!clerk.userId, userId: clerk.userId, sessionId: "sess_b2", has: () => true })),
  clerkClient: vi.fn(async () => ({
    users: {
      getUser: async (id: string) => ({ raw: clerk.users[id] }),
      deleteUser: async (id: string) => {
        clerk.deleted.push(id);
        delete clerk.users[id];
        return {};
      },
    },
  })),
  reverificationErrorResponse: () => Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));

import * as registrationRoute from "@/app/api/registration/route";
import * as guardianRoute from "@/app/api/registration/guardian/route";
import * as dobRoute from "@/app/api/v1/support/accounts/[accountId]/date-of-birth/route";
import { getAccount } from "@/lib/auth";
import { decide } from "@/lib/caps";
import { syncClerkUser } from "@/lib/accounts";
import { startCheckout } from "@/lib/billing-actions";
import type { BillingEnv } from "@/lib/billing-env";
import { NOT_ELIGIBLE } from "@/lib/registration";

type Db = ReturnType<typeof seedFake>;
let db: Db;

/** A date `years` years (plus `days` days) before today in the westernmost US time zone. */
function yearsAgo(years: number, days = 0) {
  const t = usToday();
  const d = new Date(Date.UTC(t.y - years, t.m - 1, t.d + days));
  return isoDate({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

/** A brand-new Clerk user who just signed up, signed in. */
function newClerkUser(id: string, email: string, over: Parameters<typeof clerkUser>[0] & { meta?: Record<string, unknown> } = {}) {
  const u = clerkUser({ id, email, passwordEnabled: true, twoFactorEnabled: true, ...over }) as unknown as Record<string, unknown>;
  if (over.meta) u.public_metadata = over.meta;
  clerk.users[id] = u;
  clerk.userId = id;
  return u;
}

const req = (url: string, method: string, body?: unknown) =>
  new Request(`https://ascentra.test${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const state = async () => {
  const res = await registrationRoute.GET();
  return { status: res.status, body: await res.json() };
};
const signUp = async (dateOfBirth: unknown, usResident: unknown = true) => {
  const res = await registrationRoute.POST(req("/api/registration", "POST", { dateOfBirth, usResident }));
  return { status: res.status, body: await res.json() };
};
const inviteGuardian = async (guardianEmail: unknown) => {
  const res = await guardianRoute.POST(req("/api/registration/guardian", "POST", { guardianEmail }));
  return { status: res.status, body: await res.json() };
};
const accountOf = (clerkId: string) => db.data.accounts.find((a) => a.clerk_user_id === clerkId);
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  db = seedFake();
  fake.db = db;
  clerk.userId = null;
  clerk.users = {};
  clerk.deleted = [];
});

describe("the sign-up step", () => {
  it("needs a Clerk session", async () => {
    expect((await state()).status).toBe(401);
    expect((await signUp("2000-01-01")).status).toBe(401);
  });

  it("asks a new Clerk user for their date of birth before anything else, and the API gives them nothing yet", async () => {
    newClerkUser("user_new_1", "new@example.com");
    expect(await state()).toEqual({ status: 200, body: { state: "dob" } });
    expect(await getAccount()).toBeNull();
  });

  it("18 or older: an active adult learner who can go to checkout; the date of birth is kept, never in the audit log", async () => {
    newClerkUser("user_adult_1", "Adult@Example.com");
    const dob = yearsAgo(30);
    const r = await signUp(dob);
    expect(r).toEqual({ status: 201, body: { state: "ready" } });
    expect(accountOf("user_adult_1")).toMatchObject({
      role: "learner", status: "active", is_minor: false, date_of_birth: dob, email: "adult@example.com",
    });
    expect(accountOf("user_adult_1")!.us_resident_confirmed_at).toEqual(expect.any(String));
    const account = await getAccount();
    expect(account).toMatchObject({ roleKey: "learner", isMinor: false });
    expect(decide({ role: account!.roleKey, assignedCourses: [] }, "billing.subscribe").allowed).toBe(true);
    const [event] = audit("registration.adult");
    expect(event).toMatchObject({ actor_role: "learner", result: "completed", new_value: "adult learner, active" });
    expect(JSON.stringify(db.data.audit_events)).not.toContain(dob);
    expect(await state()).toEqual({ status: 200, body: { state: "ready" } });
  });

  it("exactly 18 today is an adult; one day short of 18 is a teen", async () => {
    newClerkUser("user_18", "eighteen@example.com");
    expect((await signUp(yearsAgo(18))).body).toEqual({ state: "ready" });
    newClerkUser("user_17", "seventeen@example.com");
    expect((await signUp(yearsAgo(18, 1))).body).toEqual({ state: "guardian", guardianEmail: null });
  });

  it("an adult with a password but no second factor is told to add one before anything works", async () => {
    newClerkUser("user_adult_2", "nofactor@example.com", { twoFactorEnabled: false });
    expect((await signUp(yearsAgo(40))).body).toEqual({ state: "second_factor" });
    expect(await getAccount()).toBeNull();
  });

  it("14 to 17: a pending teen (is_minor) who can't learn, pay or message, and lands on the Guardian step", async () => {
    newClerkUser("user_teen_1", "teen@example.com");
    expect(await signUp(yearsAgo(15))).toEqual({ status: 201, body: { state: "guardian", guardianEmail: null } });
    expect(accountOf("user_teen_1")).toMatchObject({ role: "learner", status: "pending", is_minor: true });
    // Every /api/v1 route starts from getAccount: a pending teen has no account there, so nothing works.
    expect(await getAccount()).toBeNull();
    expect(audit("registration.teen")).toHaveLength(1);
    expect(await state()).toEqual({ status: 200, body: { state: "guardian", guardianEmail: null } });
  });

  it("exactly 14 today is a teen; one day short of 14 is refused", async () => {
    newClerkUser("user_14", "fourteen@example.com");
    expect((await signUp(yearsAgo(14))).body.state).toBe("guardian");
    newClerkUser("user_13", "thirteen@example.com");
    expect((await signUp(yearsAgo(14, 1))).status).toBe(403);
  });

  it("under 14: refused with a plain message; nothing is stored and the Clerk user is deleted", async () => {
    newClerkUser("user_child_1", "child@example.com");
    const before = { accounts: db.data.accounts.length, profiles: db.data.profiles.length };
    const dob = yearsAgo(12);
    const r = await signUp(dob);
    expect(r).toEqual({ status: 403, body: { error: "not_eligible", reason: NOT_ELIGIBLE } });
    expect(r.body.reason).not.toMatch(/14|age|try|again|date/i);
    expect({ accounts: db.data.accounts.length, profiles: db.data.profiles.length }).toEqual(before);
    expect(clerk.deleted).toEqual(["user_child_1"]);
    // One anonymous audit event: no email, no Clerk id, no date of birth anywhere in the database.
    const [event] = audit("registration.refused");
    expect(event).toMatchObject({ actor_account_id: null, target_id: null, target_label: null, result: "blocked" });
    const everything = JSON.stringify(db.data);
    for (const s of ["child@example.com", "user_child_1", dob]) expect(everything).not.toContain(s);
  });

  it("refuses without US residence, or with a date that isn't real or is in the future; nothing is stored", async () => {
    newClerkUser("user_x", "x@example.com");
    const before = db.data.accounts.length;
    expect((await signUp(yearsAgo(30), false)).body.reason).toMatch(/United States only/);
    for (const bad of ["2001-02-30", "2001-13-01", "1899-12-31", "3000-01-01", "01/02/2001", 20010102, null]) {
      expect((await signUp(bad)).status, String(bad)).toBe(400);
    }
    expect(db.data.accounts.length).toBe(before);
    expect(clerk.deleted).toEqual([]);
  });

  it("can't be repeated: the date of birth can't be changed by the user once set", async () => {
    newClerkUser("user_adult_3", "once@example.com");
    const dob = yearsAgo(25);
    await signUp(dob);
    const again = await signUp(yearsAgo(15));
    expect(again.status).toBe(409);
    expect(again.body.reason).toMatch(/Only Support can change it/);
    expect(accountOf("user_adult_3")).toMatchObject({ date_of_birth: dob, is_minor: false, status: "active" });
  });
});

describe("the Owner and admins never go through the sign-up step", () => {
  it("the Owner's existing account is never asked, never pending, never a minor", async () => {
    newClerkUser(clerkIdOf("owner"), TEST_ENV.OWNER_EMAIL);
    expect(await state()).toEqual({ status: 200, body: { state: "ready" } });
    expect((await signUp(yearsAgo(15))).status).toBe(409);
    expect(accountOf(clerkIdOf("owner"))).toMatchObject({ role: "owner", status: "active" });
    expect(accountOf(clerkIdOf("owner"))!.is_minor).toBeFalsy();
    expect(accountOf(clerkIdOf("owner"))!.date_of_birth).toBeUndefined();
  });

  it("an admin's existing account is never asked either", async () => {
    newClerkUser(clerkIdOf("support"), "support@example.com");
    expect((await signUp(yearsAgo(15))).status).toBe(409);
    expect(accountOf(clerkIdOf("support"))).toMatchObject({ role: "admin", status: "active" });
  });

  it("a new Clerk user with the Owner's email, an admin invite in their metadata, or an open admin invite is refused, and nothing is stored", async () => {
    db.data.role_assignments.push({ id: "inv-open", invited_email: "invited@example.com", role: "support", status: "invited", scope: [] });
    const cases: [string, string, Record<string, unknown> | undefined][] = [
      ["user_owner_twin", TEST_ENV.OWNER_EMAIL, undefined],
      ["user_meta", "meta@example.com", { ascentra_invite_id: "inv-x" }],
      ["user_invited", "invited@example.com", undefined],
    ];
    for (const [id, email, meta] of cases) {
      newClerkUser(id, email, { meta });
      expect((await state()).body.state, email).toBe("not_open");
      expect((await signUp(yearsAgo(15))).status, email).toBe(403);
      expect(accountOf(id), email).toBeUndefined();
    }
    expect(clerk.deleted).toEqual([]);
  });

  it("a Clerk user whose email isn't verified can't take the step", async () => {
    newClerkUser("user_unverified", "unverified@example.com", { verified: false });
    expect((await state()).body.state).toBe("not_open");
    expect((await signUp(yearsAgo(30))).status).toBe(403);
  });

  it("the Clerk webhook never makes an account a minor or pending, and never creates a learner", async () => {
    // A new Clerk user: the webhook creates nothing (the sign-up step does).
    expect(await syncClerkUser(clerkUser({ id: "user_hook", email: "hook@example.com" }), TEST_ENV.OWNER_EMAIL)).toBe("no_account");
    expect(accountOf("user_hook")).toBeUndefined();
    // Updates to the Owner, an admin and a waiting teen leave role, status and is_minor as they were.
    newClerkUser("user_teen_2", "teen2@example.com");
    await signUp(yearsAgo(16));
    const later = Date.now() + 60_000;
    for (const [id, email] of [[clerkIdOf("owner"), TEST_ENV.OWNER_EMAIL], [clerkIdOf("support"), "support@example.com"], ["user_teen_2", "teen2@example.com"]]) {
      const before = { ...accountOf(id)! };
      expect(await syncClerkUser(clerkUser({ id, email, twoFactorEnabled: true, passwordEnabled: true, updatedAt: later }), TEST_ENV.OWNER_EMAIL)).toBe("updated");
      const after = accountOf(id)!;
      expect({ role: after.role, status: after.status, is_minor: after.is_minor ?? false }, id)
        .toEqual({ role: before.role, status: before.status, is_minor: before.is_minor ?? false });
    }
  });
});

describe("the Guardian invitation (a stub until B3)", () => {
  beforeEach(async () => {
    newClerkUser("user_teen_3", "teen3@example.com");
    await signUp(yearsAgo(15));
  });
  const invites = () => (db.data.guardian_relationships ?? []).filter((g) => g.teen_account_id === accountOf("user_teen_3")!.id);

  it("stores the Guardian's email as an invitation and shows the teen 'Waiting for your Guardian'", async () => {
    expect(await inviteGuardian("Parent@Example.com")).toEqual({ status: 201, body: { state: "guardian", guardianEmail: "parent@example.com" } });
    expect(invites()).toEqual([expect.objectContaining({ invited_email: "parent@example.com", verification_status: "invited" })]);
    expect(invites()[0].guardian_account_id).toBeUndefined();
    expect(audit("guardian.invite")).toEqual([expect.objectContaining({ previous_value: "none", new_value: "parent@example.com", result: "completed" })]);
    expect(await state()).toEqual({ status: 200, body: { state: "guardian", guardianEmail: "parent@example.com" } });
    // Still pending: the teen can't do anything else.
    expect(accountOf("user_teen_3")!.status).toBe("pending");
    expect(await getAccount()).toBeNull();
  });

  it("lets the teen correct the email (one open invitation, every change audited)", async () => {
    await inviteGuardian("parent@example.com");
    expect((await inviteGuardian("mom@example.com")).body.guardianEmail).toBe("mom@example.com");
    expect(invites()).toHaveLength(1);
    expect(invites()[0].invited_email).toBe("mom@example.com");
    expect(audit("guardian.invite").map((e) => e.new_value)).toEqual(["parent@example.com", "mom@example.com"]);
  });

  it("refuses the teen's own email, an invalid email, and anyone who isn't a waiting teen", async () => {
    expect((await inviteGuardian("teen3@example.com")).status).toBe(400);
    expect((await inviteGuardian("not-an-email")).status).toBe(400);
    newClerkUser("user_adult_4", "adult4@example.com");
    await signUp(yearsAgo(30));
    expect((await inviteGuardian("parent@example.com")).status).toBe(403);
    clerk.userId = clerkIdOf("owner");
    expect((await inviteGuardian("parent@example.com")).status).toBe(403);
    expect(invites()).toHaveLength(0);
  });
});

describe("Support corrects a date of birth (the learner can't)", () => {
  let learnerId: string;
  const dob = yearsAgo(30);
  beforeEach(async () => {
    newClerkUser("user_adult_5", "adult5@example.com");
    await signUp(dob);
    learnerId = accountOf("user_adult_5")!.id as string;
  });
  async function patch(role: "support" | "owner" | "learner" | "superAdmin", body: Record<string, unknown>) {
    clerk.userId = clerkIdOf(role);
    const r = new Request(`https://ascentra.test/api/v1/support/accounts/${learnerId}/date-of-birth`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: JSON.stringify(body),
    });
    const res = await dobRoute.PATCH(r, { params: Promise.resolve({ accountId: learnerId }) });
    return { status: res.status, body: await res.json() };
  }

  it("Support changes it with a reason, within the same age group; audited without the dates", async () => {
    const fixed = yearsAgo(31);
    expect(await patch("support", { dateOfBirth: fixed, reason: "Learner sent ID showing a typo" })).toEqual({ status: 200, body: { changed: true } });
    expect(accountOf("user_adult_5")!.date_of_birth).toBe(fixed);
    const [event] = audit("support.dob.change").filter((e) => e.result === "completed");
    expect(event).toMatchObject({ actor_role: "support", reason: "Learner sent ID showing a typo", target_id: learnerId, is_sensitive: true });
    expect(JSON.stringify(db.data.audit_events)).not.toContain(fixed);
  });

  it("needs a reason, refuses a change of age group, and isn't open to the learner or a Super Admin", async () => {
    expect((await patch("support", { dateOfBirth: yearsAgo(31) })).status).toBe(400);
    expect((await patch("support", { dateOfBirth: yearsAgo(16), reason: "Learner says they are 16" })).status).toBe(409);
    expect((await patch("learner", { dateOfBirth: yearsAgo(31), reason: "I want to change it" })).status).toBe(403);
    expect((await patch("superAdmin", { dateOfBirth: yearsAgo(31), reason: "Not my job here" })).status).toBe(403);
    expect(accountOf("user_adult_5")!.date_of_birth).toBe(dob);
  });
});

describe("billing for a teen", () => {
  it("is refused at checkout: the Guardian is the customer of record", async () => {
    const r = await startCheckout({
      account: { id: "teen", email: "t@example.com", role: "learner", displayName: "T", roleKey: "learner", adminRole: null, assignedCourses: [], isMinor: true },
      body: { plan: "basic", agreed: true }, origin: "https://ascentra.test", stripe: {} as Stripe, env: {} as BillingEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 403, reason: "A teen's plan is chosen and paid for by their Guardian." });
  });
});

describe("someone the API refuses for another reason", () => {
  it("an invited admin without a second factor is told to add one (not a dead end)", async () => {
    const support = accountOf(clerkIdOf("support"))!;
    support.two_factor_enabled = false;
    newClerkUser(clerkIdOf("support"), "support@example.com");
    expect(await state()).toEqual({ status: 200, body: { state: "second_factor" } });
  });

  it("a disabled account has no access and can't take the sign-up step", async () => {
    accountOf(clerkIdOf("learner"))!.status = "disabled";
    newClerkUser(clerkIdOf("learner"), "learner@example.com");
    expect((await state()).body.state).toBe("not_open");
    expect((await signUp(yearsAgo(30))).status).toBe(409);
  });
});
