import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
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
import * as auditRoute from "@/app/api/v1/audit/route";
import * as auditExportRoute from "@/app/api/v1/audit/export/route";
import * as auditVerifyRoute from "@/app/api/v1/audit/verify/route";
import { ROLES, type RoleKey } from "@/lib/caps";

const ID: Record<RoleKey, string> = {
  owner: "00000000-0000-4000-8000-000000000001",
  superAdmin: "00000000-0000-4000-8000-000000000002",
  courseAdmin: "00000000-0000-4000-8000-000000000003",
  reviewer: "00000000-0000-4000-8000-000000000004",
  support: "00000000-0000-4000-8000-000000000005",
  guardian: "00000000-0000-4000-8000-000000000006",
  learner: "00000000-0000-4000-8000-000000000007",
};
const DB_ROLE: Partial<Record<RoleKey, string>> = { superAdmin: "super_admin", courseAdmin: "course_admin", reviewer: "reviewer", support: "support" };
const REASON = "Quarterly access review";
let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  db = createFakeDb({
    accounts: ROLES.map((r) => ({
      id: ID[r], clerk_user_id: `user_${r}`, email: r === "owner" ? "owner@example.com" : `${r.toLowerCase()}@example.com`,
      email_verified: true, role: r === "owner" || r === "guardian" || r === "learner" ? r : "admin", status: "active",
      password_enabled: true, two_factor_enabled: true,
    })),
    role_assignments: (Object.entries(DB_ROLE) as [RoleKey, string][]).map(([r, dbRole]) => ({
      id: `ra-${r}`, account_id: ID[r], role: dbRole, scope: r === "courseAdmin" || r === "reviewer" ? ["mkt"] : [],
      status: "active", invited_email: null,
    })),
  });
  fake.db = db;
  session.userId = "user_owner";
  session.verified = true;
  clerk.createInvitation.mockClear();
  clerk.revokeInvitation.mockClear();
});

const req = (method: string, body?: unknown, url = "http://localhost/api/v1/x") =>
  new Request(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });
const as = (role: RoleKey) => (session.userId = `user_${role}`);
const call = async (res: Promise<Response>) => {
  const r = await res;
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status, body: body as Record<string, unknown> & { reason?: string } };
};
const events = () => db.data.audit_events;
const assignment = (r: RoleKey) => db.data.role_assignments.find((a) => a.id === `ra-${r}`)!;

// ============ Every sensitive route × every role → exactly one audit event ============

type SensitiveRoute = { name: string; allowed: RoleKey[]; run: () => Promise<Response>; setup?: () => void };
const OPEN_INVITE = "00000000-0000-4000-8000-00000000abcd";
const SENSITIVE_ROUTES: SensitiveRoute[] = [
  { name: "POST /admins/invites", allowed: ["owner"], run: () => invitesRoute.POST(req("POST", { email: "new@example.com", role: "support", reason: REASON }), params()) },
  {
    name: "DELETE /admins/invites/[id]", allowed: ["owner"],
    setup: () => db.data.role_assignments.push({ id: OPEN_INVITE, status: "invited", invited_email: "open@example.com", role: "support", scope: [], clerk_invitation_id: "inv_x" }),
    run: () => inviteRoute.DELETE(req("DELETE", { reason: REASON }), params({ id: OPEN_INVITE })),
  },
  { name: "PATCH /admins/[accountId]", allowed: ["owner"], run: () => adminRoute.PATCH(req("PATCH", { role: "reviewer", courses: ["mkt"], reason: REASON }), params({ accountId: ID.support })) },
  { name: "DELETE /admins/[accountId]", allowed: ["owner"], run: () => adminRoute.DELETE(req("DELETE", { reason: REASON }), params({ accountId: ID.support })) },
  { name: "POST /audit/export", allowed: ["owner", "superAdmin"], run: () => auditExportRoute.POST(req("POST", { reason: REASON }), params()) },
];

describe.each(SENSITIVE_ROUTES)("$name writes exactly one audit event, for every role", (route) => {
  it.each([...ROLES])("%s", async (role) => {
    route.setup?.();
    as(role);
    const before = events().length;
    const r = await route.run();
    const added = events().slice(before);
    expect(added).toHaveLength(1);
    if (route.allowed.includes(role)) {
      expect(r.status, await r.clone().text()).toBeLessThan(300);
      expect(added[0]).toMatchObject({ result: "completed", status: "Recorded", reason: REASON, actor_account_id: ID[role] });
    } else {
      expect(r.status).toBe(403);
      expect(added[0]).toMatchObject({ result: "blocked", status: "No change made", actor_account_id: ID[role] });
    }
    expect(added[0].request_id).toEqual(expect.any(String));
    expect(added[0].device_id).toBeNull();
  });
});

// ============ A sensitive action without a reason: 400, nothing changes ============

describe("a sensitive action without a reason", () => {
  const NO_REASON: [string, () => Promise<Response>, () => void][] = [
    ["invite", () => invitesRoute.POST(req("POST", { email: "new@example.com", role: "support" }), params()),
      () => { expect(clerk.createInvitation).not.toHaveBeenCalled(); expect(db.data.role_assignments).toHaveLength(4); }],
    ["change a role", () => adminRoute.PATCH(req("PATCH", { role: "reviewer", courses: ["mkt"], reason: "  " }), params({ accountId: ID.support })),
      () => expect(assignment("support").role).toBe("support")],
    ["remove an admin", () => adminRoute.DELETE(req("DELETE", { reason: "ok" }), params({ accountId: ID.support })),
      () => expect(assignment("support").status).toBe("active")],
    ["revoke an invite", () => inviteRoute.DELETE(req("DELETE"), params({ id: OPEN_INVITE })),
      () => expect(clerk.revokeInvitation).not.toHaveBeenCalled()],
    ["export the audit log", () => auditExportRoute.POST(req("POST", {}), params()), () => {}],
  ];

  it.each(NO_REASON)("%s → 400, nothing changes, the refusal is recorded once", async (_name, run, unchanged) => {
    const r = await call(run());
    expect(r).toMatchObject({ status: 400, body: { error: "invalid_request", reason: expect.stringMatching(/reason/i) } });
    unchanged();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ result: "blocked", status: "No change made" });
  });

  it("refuses a reason over 500 characters", async () => {
    const r = await call(adminRoute.DELETE(req("DELETE", { reason: "x".repeat(501) }), params({ accountId: ID.support })));
    expect(r.status).toBe(400);
    expect(assignment("support").status).toBe("active");
  });
});

// ============ F4 behaviour, now recorded ============

describe("a Super Admin", () => {
  beforeEach(() => as("superAdmin"));

  it("can't invite, change a role, remove, list admins, revoke invites, or open the Owner Academy", async () => {
    expect((await call(invitesRoute.POST(req("POST", { email: "n@example.com", role: "support", reason: REASON }), params()))).status).toBe(403);
    expect((await call(adminRoute.PATCH(req("PATCH", { role: "superAdmin", reason: REASON }), params({ accountId: ID.courseAdmin })))).status).toBe(403);
    expect((await call(adminRoute.DELETE(req("DELETE", { reason: REASON }), params({ accountId: ID.courseAdmin })))).status).toBe(403);
    expect((await call(adminsRoute.GET(req("GET"), params()))).status).toBe(403);
    expect((await call(ownerAcademyRoute.GET(req("GET"), params()))).body.reason).toMatch(/Only the Owner/);
    expect(clerk.createInvitation).not.toHaveBeenCalled();
    expect(events()).toHaveLength(5);
    expect(events().every((e) => e.result === "blocked" && e.status === "No change made")).toBe(true);
  });
});

describe("the Owner", () => {
  it("invites an admin: the invite row, the Clerk invitation, and one Completed event with the reason", async () => {
    const r = await call(invitesRoute.POST(req("POST", { email: "New@Example.com", role: "reviewer", courses: ["mkt"], reason: REASON }), params()));
    expect(r.status).toBe(201);
    const row = db.data.role_assignments.find((a) => a.invited_email === "new@example.com")!;
    expect(clerk.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ publicMetadata: { ascentra_invite_id: row.id } }));
    expect(events()).toMatchObject([{
      action: "admins.invite", actor_label: "owner@example.com (Owner)", target_label: "new@example.com",
      new_value: "Learning Reviewer (mkt)", reason: REASON, result: "completed", is_sensitive: true,
    }]);
  });

  it("changes a role, recording previous and new values", async () => {
    expect((await call(adminRoute.PATCH(req("PATCH", { role: "reviewer", courses: ["mkt"], reason: REASON }), params({ accountId: ID.support })))).status).toBe(200);
    expect(events()).toMatchObject([{ action: "admins.role.change", previous_value: "Support Admin", new_value: "Learning Reviewer (mkt)" }]);
  });

  it("saves nothing when Clerk refuses the invitation, and records the failure", async () => {
    clerk.createInvitation.mockRejectedValueOnce(new Error("rate limited"));
    const r = await call(invitesRoute.POST(req("POST", { email: "new@example.com", role: "support", reason: REASON }), params()));
    expect(r.status).toBe(502);
    expect(db.data.role_assignments).toHaveLength(4);
    expect(events()).toMatchObject([{ result: "blocked" }]);
  });
});

describe("role values and Owner protections", () => {
  it.each(["owner", "Owner", "superadmin", "admin"])('refuses setting a role to "%s" (400, recorded)', async (role) => {
    const r = await call(adminRoute.PATCH(req("PATCH", { role, courses: [], reason: REASON }), params({ accountId: ID.courseAdmin })));
    expect(r).toMatchObject({ status: 400, body: { reason: expect.stringMatching(/isn't an administrator role/) } });
    expect(assignment("courseAdmin").role).toBe("course_admin");
    expect(events()).toMatchObject([{ result: "blocked", new_value: role }]);
  });

  it("refuses demoting or removing the Owner, recorded as Blocked", async () => {
    expect((await call(adminRoute.PATCH(req("PATCH", { role: "support", reason: REASON }), params({ accountId: ID.owner })))).body.reason)
      .toMatch(/Owner can't be demoted/);
    expect((await call(adminRoute.DELETE(req("DELETE", { reason: REASON }), params({ accountId: ID.owner })))).body.reason)
      .toMatch(/Owner can't be removed, suspended or deleted/);
    expect(db.data.accounts.find((a) => a.id === ID.owner)).toMatchObject({ role: "owner", status: "active" });
    expect(events()).toMatchObject([
      { result: "blocked", target_label: "owner@example.com" },
      { result: "blocked", target_label: "owner@example.com" },
    ]);
  });

  it("asks to re-verify the second factor before a sensitive change, and records nothing yet", async () => {
    session.verified = false;
    const r = await call(adminRoute.PATCH(req("PATCH", { role: "support", reason: REASON }), params({ accountId: ID.courseAdmin })));
    expect(r).toMatchObject({ status: 403, body: { clerk_error: { reason: "reverification-error" } } });
    expect(assignment("courseAdmin").role).toBe("course_admin");
    expect(events()).toHaveLength(0);
  });
});

// ============ Reading the audit log ============

describe("reading the audit log", () => {
  it.each([...ROLES])("%s", async (role) => {
    as(role);
    const r = await call(auditRoute.GET(req("GET"), params()));
    expect(r.status).toBe(role === "owner" || role === "superAdmin" ? 200 : 403);
  });

  it("is refused without a session", async () => {
    session.userId = null;
    expect((await call(auditRoute.GET(req("GET"), params()))).status).toBe(401);
  });

  it("searches by actor, action, target and date", async () => {
    await call(invitesRoute.POST(req("POST", { email: "one@example.com", role: "support", reason: REASON }), params()));
    as("learner");
    await call(auditRoute.GET(req("GET"), params())); // a Blocked read by the learner
    as("owner");
    const search = async (q: string) =>
      ((await call(auditRoute.GET(req("GET", undefined, `http://localhost/api/v1/audit?${q}`), params()))).body.events as { action: string }[]).map((e) => e.action);
    expect(await search("action=invite")).toEqual(["admins.invite"]);
    expect(await search("actor=learner")).toEqual(["audit.view"]);
    expect(await search("target=one@example")).toEqual(["admins.invite"]);
    expect(await search(`from=${new Date().toISOString().slice(0, 10)}`)).toHaveLength(2);
    expect(await search("to=2000-01-01")).toEqual([]);
  });

  it("export returns CSV and is itself recorded", async () => {
    await call(invitesRoute.POST(req("POST", { email: "one@example.com", role: "support", reason: REASON }), params()));
    const r = await auditExportRoute.POST(req("POST", { action: "invite", reason: REASON }), params());
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    const csv = await r.text();
    expect(csv.split("\r\n")[0]).toMatch(/^seq,at,actor,actorRole,action/);
    expect(csv).toContain("admins.invite");
    expect(events().at(-1)).toMatchObject({ action: "audit.export", reason: REASON, is_sensitive: true, context: expect.stringMatching(/Exported 1 audit event/) });
  });

  it.each([...ROLES])("only the Owner can run the chain check (%s)", async (role) => {
    as(role);
    const r = await call(auditVerifyRoute.POST(req("POST"), params()));
    expect(r.status).toBe(role === "owner" ? 200 : 403);
    expect(events()).toHaveLength(1);
  });
});
