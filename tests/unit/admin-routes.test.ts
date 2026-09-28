import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const recordAuditEvent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
const session = vi.hoisted(() => ({ userId: "user_owner" as string | null, verified: true }));
const clerk = vi.hoisted(() => ({
  createInvitation: vi.fn(async () => ({ id: "inv_clerk_1" })),
  revokeInvitation: vi.fn(async () => ({})),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () =>
    session.userId
      ? { isAuthenticated: true, userId: session.userId, has: () => session.verified }
      : { isAuthenticated: false, userId: null },
  ),
  clerkClient: vi.fn(async () => ({ invitations: clerk })),
  reverificationErrorResponse: () =>
    Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));

import * as adminsRoute from "@/app/api/v1/admins/route";
import * as invitesRoute from "@/app/api/v1/admins/invites/route";
import * as inviteRoute from "@/app/api/v1/admins/invites/[id]/route";
import * as adminRoute from "@/app/api/v1/admins/[accountId]/route";
import * as ownerAcademyRoute from "@/app/api/v1/owner-academy/route";

const IDS = {
  owner: "00000000-0000-4000-8000-000000000001",
  superAdmin: "00000000-0000-4000-8000-000000000002",
  courseAdmin: "00000000-0000-4000-8000-000000000003",
  learner: "00000000-0000-4000-8000-000000000004",
};
const account = (key: keyof typeof IDS, role: string, email: string) => ({
  id: IDS[key], clerk_user_id: `user_${key}`, email, email_verified: true, role, status: "active",
  password_enabled: true, two_factor_enabled: true,
});
let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  db = createFakeDb({
    accounts: [
      account("owner", "owner", "owner@example.com"),
      account("superAdmin", "admin", "quinn@example.com"),
      account("courseAdmin", "admin", "morgan@example.com"),
      account("learner", "learner", "maya@example.com"),
    ],
    role_assignments: [
      { id: "ra-quinn", account_id: IDS.superAdmin, role: "super_admin", scope: [], status: "active", invited_email: null },
      { id: "ra-morgan", account_id: IDS.courseAdmin, role: "course_admin", scope: ["mkt"], status: "active", invited_email: null },
    ],
  });
  fake.db = db;
  session.userId = "user_owner";
  session.verified = true;
  recordAuditEvent.mockClear();
  clerk.createInvitation.mockClear();
  clerk.revokeInvitation.mockClear();
});

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/v1/x", { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const as = (key: keyof typeof IDS) => (session.userId = `user_${key}`);
const call = async (res: Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: await r.json() };
};
const invite = (body: unknown) => call(invitesRoute.POST(req("POST", body), params({})));
const changeRole = (accountId: string, body: unknown) => call(adminRoute.PATCH(req("PATCH", body), params({ accountId })));
const remove = (accountId: string) => call(adminRoute.DELETE(req("DELETE"), params({ accountId })));

describe("a Super Admin", () => {
  beforeEach(() => as("superAdmin"));

  it("can't invite an admin", async () => {
    const r = await invite({ email: "new@example.com", role: "support" });
    expect(r).toMatchObject({ status: 403, body: { error: "forbidden", reason: expect.stringMatching(/Only the Owner/) } });
    expect(clerk.createInvitation).not.toHaveBeenCalled();
    expect(db.data.role_assignments).toHaveLength(2);
  });

  it("can't change a role", async () => {
    const r = await changeRole(IDS.courseAdmin, { role: "superAdmin" });
    expect(r.status).toBe(403);
    expect(db.data.role_assignments.find((a) => a.id === "ra-morgan")!.role).toBe("course_admin");
  });

  it("can't remove an admin, list admins, or revoke invites", async () => {
    expect((await remove(IDS.courseAdmin)).status).toBe(403);
    expect((await call(adminsRoute.GET(req("GET"), params({})))).status).toBe(403);
    expect((await call(inviteRoute.DELETE(req("DELETE"), params({ id: "ra-morgan" })))).status).toBe(403);
  });

  it("can't open the Owner Academy", async () => {
    const r = await call(ownerAcademyRoute.GET(req("GET"), params({})));
    expect(r).toMatchObject({ status: 403, body: { reason: expect.stringMatching(/Only the Owner/) } });
  });

  it("has each refusal recorded", async () => {
    await invite({ email: "new@example.com", role: "support" });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "capability.refused", actorAccountId: IDS.superAdmin }));
  });
});

describe("the Owner", () => {
  it("can open the Owner Academy", async () => {
    expect((await call(ownerAcademyRoute.GET(req("GET"), params({})))).status).toBe(200);
  });

  it("invites an admin: a single invite row, and a Clerk invitation carrying its id", async () => {
    const r = await invite({ email: "New@Example.com", role: "reviewer", courses: ["mkt"] });
    expect(r.status).toBe(201);
    const row = db.data.role_assignments.find((a) => a.invited_email === "new@example.com")!;
    expect(row).toMatchObject({ status: "invited", role: "reviewer", scope: ["mkt"], clerk_invitation_id: "inv_clerk_1" });
    expect(clerk.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "new@example.com", publicMetadata: { ascentra_invite_id: row.id }, expiresInDays: 7,
    }));
  });

  it("saves nothing when Clerk refuses the invitation", async () => {
    clerk.createInvitation.mockRejectedValueOnce(new Error("rate limited"));
    const r = await invite({ email: "new@example.com", role: "support" });
    expect(r.status).toBe(502);
    expect(db.data.role_assignments).toHaveLength(2);
  });

  it("can't invite an email that already has an account, or twice while one is open", async () => {
    expect((await invite({ email: "maya@example.com", role: "support" })).status).toBe(409);
    expect((await invite({ email: "new@example.com", role: "support" })).status).toBe(201);
    expect((await invite({ email: "new@example.com", role: "support" })).status).toBe(409);
  });

  it("revokes an open invite, in Clerk too", async () => {
    await invite({ email: "new@example.com", role: "support" });
    const row = db.data.role_assignments.find((a) => a.invited_email === "new@example.com")!;
    const r = await call(inviteRoute.DELETE(req("DELETE"), params({ id: row.id as string })));
    expect(r.status).toBe(200);
    expect(row.status).toBe("revoked");
    expect(clerk.revokeInvitation).toHaveBeenCalledWith("inv_clerk_1");
  });

  it("changes an admin's role and removes an admin", async () => {
    expect((await changeRole(IDS.courseAdmin, { role: "reviewer", courses: ["mkt", "creator"] })).status).toBe(200);
    expect(db.data.role_assignments.find((a) => a.id === "ra-morgan")).toMatchObject({ role: "reviewer", scope: ["mkt", "creator"] });
    expect((await remove(IDS.courseAdmin)).status).toBe(200);
    expect(db.data.role_assignments.find((a) => a.id === "ra-morgan")!.status).toBe("revoked");
  });

  it("lists admins and open invites", async () => {
    await invite({ email: "new@example.com", role: "support" });
    const r = await call(adminsRoute.GET(req("GET"), params({})));
    expect(r.body.admins.map((a: { role: string }) => a.role).sort()).toEqual(["courseAdmin", "superAdmin"]);
    expect(r.body.invites).toMatchObject([{ email: "new@example.com", role: "support", expired: false }]);
  });
});

describe("role values and Owner protections", () => {
  it.each(["owner", "Owner", "superadmin", "admin"])('refuses setting a role to "%s"', async (role) => {
    const r = await changeRole(IDS.courseAdmin, { role, courses: [] });
    expect(r).toMatchObject({ status: 400, body: { error: "invalid_request", reason: expect.stringMatching(/isn't an administrator role/) } });
    expect(db.data.role_assignments.find((a) => a.id === "ra-morgan")!.role).toBe("course_admin");
    expect((await invite({ email: "x@example.com", role })).status).toBe(400);
  });

  it("refuses demoting the Owner", async () => {
    const r = await changeRole(IDS.owner, { role: "support" });
    expect(r).toMatchObject({ status: 403, body: { reason: expect.stringMatching(/Owner can't be demoted/) } });
    expect(db.data.accounts.find((a) => a.id === IDS.owner)!.role).toBe("owner");
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "owner.protected" }));
  });

  it("refuses removing, suspending or deleting the Owner", async () => {
    const r = await remove(IDS.owner);
    expect(r).toMatchObject({ status: 403, body: { reason: expect.stringMatching(/Owner can't be removed, suspended or deleted/) } });
    expect(db.data.accounts.find((a) => a.id === IDS.owner)).toMatchObject({ role: "owner", status: "active" });
  });

  it("asks to re-verify the second factor before a sensitive change", async () => {
    session.verified = false;
    const r = await changeRole(IDS.courseAdmin, { role: "support" });
    expect(r).toMatchObject({ status: 403, body: { clerk_error: { reason: "reverification-error" } } });
    expect(db.data.role_assignments.find((a) => a.id === "ra-morgan")!.role).toBe("course_admin");
  });
});

describe("learners and Course Admins", () => {
  it.each(["learner", "courseAdmin"] as const)("%s gets 403 on every admin route", async (who) => {
    as(who);
    expect((await call(adminsRoute.GET(req("GET"), params({})))).status).toBe(403);
    expect((await invite({ email: "x@example.com", role: "support" })).status).toBe(403);
    expect((await changeRole(IDS.superAdmin, { role: "support" })).status).toBe(403);
    expect((await call(ownerAcademyRoute.GET(req("GET"), params({})))).status).toBe(403);
  });
});
