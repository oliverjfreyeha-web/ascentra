/**
 * Gate 1: every role × every capability, expecting allow or 403.
 *
 * The expectations below are written out by hand from the prototype's text (ROLE_CAPS, NEVER_CAPS,
 * ROLE_PERMS, courseAllowed in reference/ascentra.html). They deliberately do not read lib/caps.ts's
 * ROLE_CAPS, so a wrong entry in the capability map fails here instead of agreeing with itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordAudit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/audit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/audit")>()), recordAudit }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
  reverificationErrorResponse: () =>
    Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));

import { requireCap } from "@/lib/auth/require-cap";
import { ALL_CAPS, ROLES, type Action, type RoleKey, type Target } from "@/lib/caps";
import type { AuthContext } from "@/lib/auth";

const ALL = [...ROLES];
const ASSIGNED = ["mkt", "creator"];

/** Global capabilities: which roles hold them. */
const GLOBAL: Record<string, RoleKey[]> = {
  // NEVER_CAPS: the Owner only.
  "admins.view": ["owner"],
  "admins.invite": ["owner"],
  "admins.role.change": ["owner"],
  "admins.revoke": ["owner"],
  "ownership.transfer": ["owner"],
  "owner_academy.open": ["owner"],
  "owner_academy.edit": ["owner"],
  "pricing.change": ["owner"],
  // F5: the audit log. Owner and Super Admin read and export it; only the Owner verifies the chain.
  "audit.view": ["owner", "superAdmin"],
  "audit.export": ["owner", "superAdmin"],
  "audit.verify": ["owner"],
  // Super Admin: operate the platform (not admin management), inspect, Pro access.
  "platform.operate": ["owner", "superAdmin"],
  "support_states.inspect": ["owner", "superAdmin"],
  "access.pro": ["owner", "superAdmin"],
  "access.basic": ["courseAdmin", "reviewer", "support"],
  "entitlements.inspect": ["owner", "superAdmin", "support"],
  "security.inspect": ["owner", "superAdmin", "support"],
  // Support: lifecycle, Guardian link, recovery links, device slots, appeals.
  "lifecycle.inspect": ["owner", "support"],
  "guardian_links.inspect": ["owner", "support"],
  "support.recovery.send": ["owner", "support"],
  "support.device.free": ["owner", "support"],
  // Appeals: the prototype's decideAppeal checks inspectAccounts (owner, superAdmin, support).
  "support.appeal.decide": ["owner", "superAdmin", "support"],
  // F6 safeguard steps: "Limit needs Support; Suspend needs a Super Admin or the Owner."
  "security.limit": ["owner", "support"],
  // B2: a date of birth is set once at sign-up; only Support (or the Owner) corrects it, with a reason.
  "support.dob.change": ["owner", "support"],
  "security.suspend": ["owner", "superAdmin"],
  // Everyone / learners / guardians.
  "self.view": ALL,
  "devices.manage": ALL,
  "billing.view": ALL,
  "billing.subscribe": ["guardian", "learner"],
  "billing.portal": ["guardian", "learner"],
  // B4: cancel, privacy, and the Owner's refunds and credits.
  "billing.cancel": ["guardian", "learner"],
  "privacy.view": ALL,
  "privacy.export": ALL,
  "privacy.delete.request": ALL.filter((r) => r !== "owner"),
  "privacy.consent.withdraw": ["guardian", "learner"],
  "billing.adjustments.view": ["owner"],
  "billing.refund": ["owner"],
  "billing.credit": ["owner"],
  // L1: the source library. Owner and Reviewer add, approve and decide; the open-license list is the Owner's.
  "sources.library.view": ["owner", "superAdmin", "courseAdmin", "reviewer"],
  "sources.search": ["owner", "superAdmin", "courseAdmin", "reviewer"],
  "sources.library.add": ["owner", "reviewer"],
  "sources.library.decide": ["owner", "reviewer"],
  "sources.claims.manage": ["owner", "reviewer"],
  "sources.conflicts.decide": ["owner", "reviewer"],
  "sources.open_list.edit": ["owner"],
  "ai.status": ["owner", "superAdmin"],
  // L2: course generation. The course scope (assigned courses) is applied by each route on top of these.
  "sources.research": ["owner", "superAdmin", "courseAdmin", "reviewer"],
  "courses.view": ["owner", "superAdmin", "courseAdmin", "reviewer"],
  "courses.build": ["owner", "superAdmin", "courseAdmin"],
  "courses.verify": ["owner", "reviewer"],
  "courses.release": ["owner", "superAdmin", "courseAdmin"],
  // L3: the Owner sets the refresh interval; builders and Reviewers queue a refresh.
  "courses.refresh.configure": ["owner"],
  "courses.refresh.run": ["owner", "superAdmin", "courseAdmin", "reviewer"],
  // L6: the topic catalog.
  "catalog.view": ["owner", "courseAdmin", "reviewer"],
  "catalog.queue": ["owner", "courseAdmin"],
  // L7: the anonymous course-request queue.
  "course_requests.view": ["owner", "courseAdmin"],
  "course_requests.manage": ["owner", "courseAdmin"],
  // L8: the topics learners pick from (Owner and authorized staff); a learner's business (the Owner only).
  "topics.view": ["owner", "superAdmin", "courseAdmin"],
  "topics.manage": ["owner", "superAdmin", "courseAdmin"],
  "picks.inspect": ["owner"],
  "picks.override": ["owner"],
  // C1: the Owner's review, publishing a whole course, the videos and the boosters list.
  "courses.owner_review": ["owner"],
  "courses.publish_course": ["owner"],
  "courses.videos": ["owner"],
  "courses.boosters": ["owner"],
  // L4: the safety review queue.
  "safety.view": ["owner", "superAdmin"],
  "safety.review": ["owner", "superAdmin"],
  "devices.replace": ALL,
  "security.verify": ALL,
  "security.appeal.submit": ALL,
  "learn": ["owner", "superAdmin", "courseAdmin", "reviewer", "support", "learner"],
  "guardian.controls": ["guardian"],
  // B3: Guardians verify, agree for a teen, and withdraw. The Owner is never a Guardian.
  "guardian.identity.verify": ["guardian"],
  "guardian.consent.give": ["guardian"],
  "guardian.consent.withdraw": ["guardian"],
  // "Never sees payment details, private notes, or Mentor conversations": nobody.
  "billing.payment_details.view": [],
  "learners.private_notes.view": [],
  "learners.mentor.view": [],
};

type CourseRule = "every" | "assigned" | "none";
/** Course capabilities: every course (never the Owner Academy), assigned courses only, or none. */
const COURSE: Record<string, Partial<Record<RoleKey, CourseRule>>> = {
  "courses.edit": { owner: "every", superAdmin: "every", courseAdmin: "assigned" },
  "courses.publish": { owner: "every", superAdmin: "every", courseAdmin: "assigned" },
  "courses.archive": { owner: "every", superAdmin: "every", courseAdmin: "assigned" },
  "courses.restore": { owner: "every", superAdmin: "every", courseAdmin: "assigned" },
  "courses.review": { owner: "every", reviewer: "assigned" },
  "sources.flag": { owner: "every", courseAdmin: "assigned" },
  "sources.review": { owner: "every", superAdmin: "every" },
  "sources.resolve": { owner: "every", superAdmin: "every", reviewer: "assigned" },
  "work.evaluate": { owner: "every", superAdmin: "every", reviewer: "assigned" },
};

const SENSITIVE = new Set([
  "admins.invite", "admins.role.change", "admins.revoke", "ownership.transfer", "owner_academy.edit", "pricing.change",
  "courses.publish", "courses.archive", "courses.restore",
  "support.recovery.send", "support.device.free", "support.appeal.decide",
  "audit.export",
  // F6: replacing a device and the Verify step re-check the second factor; so do Limit and Suspend.
  "devices.replace", "security.verify", "security.limit", "security.suspend", "billing.portal",
  "support.dob.change", "guardian.consent.give", "guardian.consent.withdraw",
  "privacy.export", "privacy.delete.request", "billing.refund", "billing.credit",
  // L2: publishing a lesson version.
  "courses.release",
  // L8: changing a learner's locked business.
  "picks.override",
  // C1: the Owner's module approval, and publishing or unpublishing a course.
  "courses.owner_review", "courses.publish_course",
]);

/** F5: actions that must carry a reason (role and invite changes, ownership, publishing, archiving and
 *  restoring, the Owner Academy, prices, support actions on security and appeals, audit export). */
const REASON = new Set([
  "admins.invite", "admins.role.change", "admins.revoke", "ownership.transfer", "owner_academy.edit", "pricing.change",
  "courses.publish", "courses.archive", "courses.restore",
  "support.recovery.send", "support.device.free", "support.appeal.decide",
  "audit.export",
  // F6: Limit and Suspend are applied with a reason.
  "security.limit", "security.suspend",
  // B2: correcting a date of birth. B3: withdrawing consent for a teen.
  "support.dob.change", "guardian.consent.withdraw",
  // B4: refunds and credits. L1: approving or rejecting a source, an authority decision, the open-license list.
  "billing.refund", "billing.credit", "sources.library.decide", "sources.conflicts.decide", "sources.open_list.edit",
  // L2: publishing a lesson version. L3: the refresh interval.
  "courses.release", "courses.refresh.configure",
  // L4: reviewing a safety event.
  "safety.review",
  // L7: deciding a course request.
  "course_requests.manage",
  // L8: changing a learner's locked business.
  "picks.override",
  // C1: publishing or unpublishing a whole course.
  "courses.publish_course",
]);

function ctx(role: RoleKey, { verified = true, courses }: { verified?: boolean; courses?: string[] } = {}): AuthContext {
  const assigned = courses ?? (role === "courseAdmin" || role === "reviewer" ? ASSIGNED : []);
  return {
    account: {
      id: `acc_${role}`, email: `${role}@example.com`, role: role === "owner" ? "owner" : role === "guardian" ? "guardian" : role === "learner" ? "learner" : "admin",
      displayName: role, roleKey: role, adminRole: null, assignedCourses: assigned, isMinor: false,
    },
    sessionId: `sess_${role}`,
    recentlyVerified: () => verified,
  };
}

async function outcome(role: RoleKey, action: Action, target?: Target, opts?: { verified?: boolean; courses?: string[] }) {
  const res = await requireCap(ctx(role, opts), action, target);
  if (!res) return { status: "allow" as const };
  const body = await res.json();
  return { status: res.status, body };
}

beforeEach(() => recordAudit.mockClear());

describe("the capability map covers exactly the capabilities this suite specifies", () => {
  it("has no capability the suite doesn't specify, and the suite has none the map lacks", () => {
    const specified = new Set([
      ...Object.keys(GLOBAL),
      ...Object.keys(COURSE).flatMap((a) => [`${a}.any`, `${a}.assigned`]),
    ]);
    for (const cap of ALL_CAPS) expect(specified.has(cap), `${cap} is not in the Gate 1 table`).toBe(true);
    for (const a of Object.keys(GLOBAL)) expect(ALL_CAPS, a).toContain(a);
  });
});

describe.each(Object.entries(GLOBAL))("%s", (action, allowed) => {
  it.each(ALL)("%s", async (role) => {
    const r = await outcome(role, action as Action);
    if (allowed.includes(role)) {
      expect(r).toEqual({ status: "allow" });
    } else {
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: "forbidden", reason: expect.any(String) });
      expect(recordAudit).toHaveBeenCalledTimes(1);
      expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action, result: "Blocked" }));
    }
  });
});

describe.each(Object.entries(COURSE))("%s", (action, rules) => {
  it.each(ALL)("%s: assigned course, unassigned course, Owner Academy", async (role) => {
    const rule = rules[role] ?? "none";
    const assigned = await outcome(role, action as Action, { course: "mkt" });
    const unassigned = await outcome(role, action as Action, { course: "sales" });
    const ownerAcademy = await outcome(role, action as Action, { course: "gsa" });

    expect(assigned.status).toBe(rule === "none" ? 403 : "allow");
    expect(unassigned.status).toBe(rule === "every" ? "allow" : 403);
    // Nobody reaches the Owner Academy through course capabilities, the Owner included
    // (the Owner opens it with owner_academy.*).
    expect(ownerAcademy.status).toBe(403);
    if (rule !== "none") expect(ownerAcademy.body.reason).toMatch(/Owner Academy is protected/);
  });

  it("is refused without a course", async () => {
    expect((await outcome("owner", action as Action)).status).toBe(403);
  });
});

describe("scope can't be widened by what's stored", () => {
  it("a Course Admin with the Owner Academy in their assignment still can't touch it", async () => {
    const r = await outcome("courseAdmin", "courses.edit", { course: "gsa" }, { courses: ["gsa", "mkt"] });
    expect(r.status).toBe(403);
  });

  it("an admin assigned every course still can't use an Owner-only capability", async () => {
    const NEVER_CAPS = ["admins.view", "admins.invite", "admins.role.change", "admins.revoke", "ownership.transfer",
      "owner_academy.open", "owner_academy.edit", "pricing.change"];
    for (const action of NEVER_CAPS) {
      const r = await outcome("superAdmin", action as Action, undefined, { courses: ["mkt", "sales", "gsa"] });
      expect(r.status, action).toBe(403);
      expect(r.body.reason).toMatch(/Only the Owner/);
    }
  });
});

describe("sensitive actions re-check the second factor", () => {
  const cases: [RoleKey, Action, Target | undefined][] = [
    ["owner", "admins.invite", undefined],
    ["owner", "admins.role.change", undefined],
    ["owner", "admins.revoke", undefined],
    ["owner", "pricing.change", undefined],
    ["owner", "owner_academy.edit", undefined],
    ["owner", "ownership.transfer", undefined],
    ["superAdmin", "courses.publish", { course: "sales" }],
    ["courseAdmin", "courses.restore", { course: "mkt" }],
    ["support", "support.device.free", undefined],
    ["support", "support.recovery.send", undefined],
  ];

  it.each(cases)("%s %s: allowed after a recent second factor, reverification otherwise", async (role, action, target) => {
    expect(await outcome(role, action, target, { verified: true })).toEqual({ status: "allow" });
    const r = await outcome(role, action, target, { verified: false });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ clerk_error: { reason: "reverification-error" } });
  });

  it("marks exactly the expected actions as needing a reason", async () => {
    const { requiresReason } = await import("@/lib/caps");
    for (const action of [...Object.keys(GLOBAL), ...Object.keys(COURSE)]) {
      expect(requiresReason(action as Action), action).toBe(REASON.has(action));
    }
  });

  it("marks exactly the expected actions as sensitive", async () => {
    const { isSensitive } = await import("@/lib/caps");
    for (const action of [...Object.keys(GLOBAL), ...Object.keys(COURSE)]) {
      expect(isSensitive(action as Action), action).toBe(SENSITIVE.has(action));
    }
  });

  it("doesn't ask for reverification before refusing someone who lacks the capability", async () => {
    const r = await outcome("superAdmin", "admins.invite", undefined, { verified: false });
    expect(r.body).toMatchObject({ error: "forbidden" });
  });
});
