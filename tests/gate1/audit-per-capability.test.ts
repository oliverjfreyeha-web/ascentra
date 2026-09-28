/**
 * Gate 1 (F5): every action that needs a reason writes exactly one audit event per request, for every
 * role, whatever the handler does. A stand-in route is built for each such capability, so routes added
 * later (publish, archive, restore, support actions) are covered by the same guarantee.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";
import { deviceCookie, trustedDeviceRow } from "../fixtures/devices";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, has: () => true })),
  clerkClient: vi.fn(),
  reverificationErrorResponse: vi.fn(),
}));

import { withCap } from "@/lib/auth";
import { ALL_CAPS, ROLES, decide, requiresReason, type Action, type RoleKey } from "@/lib/caps";

const ADMIN_DB: Partial<Record<RoleKey, string>> = { superAdmin: "super_admin", courseAdmin: "course_admin", reviewer: "reviewer", support: "support" };
const REASON_ACTIONS = [...new Set(ALL_CAPS.filter((c) => requiresReason(c)).map((c) => c.replace(/\.(any|assigned)$/, "")))] as Action[];
let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  db = createFakeDb({
    accounts: ROLES.map((r, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`, clerk_user_id: `user_${r}`, email: r === "owner" ? "owner@example.com" : `${r}@example.com`,
      email_verified: true, role: ADMIN_DB[r] ? "admin" : r, status: "active", password_enabled: true, two_factor_enabled: true,
    })),
    role_assignments: ROLES.filter((r) => ADMIN_DB[r]).map((r) => ({
      id: `ra-${r}`, account_id: `00000000-0000-4000-8000-00000000000${ROLES.indexOf(r)}`, role: ADMIN_DB[r],
      scope: r === "courseAdmin" || r === "reviewer" ? ["mkt"] : [], status: "active",
    })),
    trusted_devices: ROLES.map((r, i) => trustedDeviceRow(`00000000-0000-4000-8000-00000000000${i}`)),
  });
  fake.db = db;
});

const courseAction = (a: Action) => /^courses\./.test(a);
const target = () => ({ course: "mkt" });

describe.each(REASON_ACTIONS)("%s", (action) => {
  // Handlers that forget to record, record once, or fail: the count is still exactly one.
  const handlers = {
    "records nothing itself": async () => Response.json({ ok: true }),
    "records its own event": async (_r: Request, _c: unknown, _a: unknown, x: { audit: (e: never) => Promise<void> }) => {
      await x.audit({ action, context: "Done.", result: "Completed" } as never);
      return Response.json({ ok: true });
    },
    "fails with 409": async () => Response.json({ reason: "Conflict." }, { status: 409 }),
  };

  it.each(Object.keys(handlers))("handler %s: exactly one event for every role, with and without a reason", async (kind) => {
    const route = withCap(action, handlers[kind as keyof typeof handlers] as never, courseAction(action) ? { target } : {});
    for (const role of ROLES) {
      session.userId = `user_${role}`;
      for (const reason of ["Monthly access review", undefined]) {
        const before = db.data.audit_events.length;
        const res = await route(
          new Request("http://localhost/x", {
            method: "POST", body: JSON.stringify(reason ? { reason } : {}),
            headers: { "content-type": "application/json", cookie: deviceCookie(`00000000-0000-4000-8000-00000000000${ROLES.indexOf(role)}`) },
          }),
          { params: Promise.resolve({}) },
        );
        const added = db.data.audit_events.slice(before);
        expect(added, `${role} ${reason ? "with" : "without"} reason`).toHaveLength(1);

        const allowed = decide({ role, assignedCourses: ["mkt"] }, action, courseAction(action) ? target() : undefined).allowed;
        if (!allowed) expect([res.status, added[0].result]).toEqual([403, "blocked"]);
        else if (!reason) expect([res.status, added[0].result]).toEqual([400, "blocked"]);
        else if (kind === "fails with 409") expect([res.status, added[0].result]).toEqual([409, "blocked"]);
        else expect([res.status, added[0].result, added[0].reason]).toEqual([200, "completed", reason]);
      }
    }
  });
});
