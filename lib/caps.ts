/**
 * The single capability map. Every permission decision in ASCENTRA comes from here.
 *
 * Source: reference/ascentra.html (ROLE_CAPS, NEVER_CAPS, ADMIN_ROLES, ROLE_PERMS, courseAllowed).
 * Each capability carries the prototype line it comes from. Capabilities that end in `.assigned`
 * hold only for the courses in the admin's role assignment; `.any` holds for every course except
 * the protected Owner Academy, which only the owner.* capabilities reach.
 *
 * Pure: no database, no request. lib/auth/caps.ts applies it to a signed-in Account.
 */

/** The prototype's ADMIN_ROLES, exactly. */
export const ADMIN_ROLES = ["superAdmin", "courseAdmin", "reviewer", "support"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLES = ["owner", ...ADMIN_ROLES, "guardian", "learner"] as const;
export type RoleKey = (typeof ROLES)[number];

export const ROLE_LABEL: Record<RoleKey, string> = {
  owner: "Owner",
  superAdmin: "Super Admin",
  courseAdmin: "Course Admin",
  reviewer: "Learning Reviewer",
  support: "Support Admin",
  guardian: "Guardian",
  learner: "Learner",
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/** The protected Owner Academy (prototype id "gsa", Growth System Academy). */
export const OWNER_ACADEMY_SLUG = "gsa";

type Scope = "global" | "any" | "assigned";
type CapDef = { scope: Scope; from: string; sensitive?: true };

export const CAPABILITIES = {
  // ---- NEVER_CAPS: the Owner only, whatever the database says ----
  "admins.view": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)" },
  "admins.invite": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)", sensitive: true },
  "admins.role.change": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)", sensitive: true },
  "admins.revoke": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)", sensitive: true },
  "ownership.transfer": { scope: "global", from: "NEVER_CAPS: Change or transfer ownership (Owner only)", sensitive: true },
  "owner_academy.open": { scope: "global", from: "NEVER_CAPS: Open or change the protected Owner Academy (Owner only)" },
  "owner_academy.edit": { scope: "global", from: "NEVER_CAPS: Open or change the protected Owner Academy (Owner only)", sensitive: true },
  "pricing.change": { scope: "global", from: "NEVER_CAPS: Change plan prices (locked: Basic $20, Pro $50)", sensitive: true },

  // ---- Super Admin ----
  "platform.operate": { scope: "global", from: "superAdmin: Operate platform areas (not administrator management)" },
  "courses.edit.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy" },
  "courses.publish.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy", sensitive: true },
  "courses.archive.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy", sensitive: true },
  "courses.restore.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy", sensitive: true },
  "sources.review.any": { scope: "any", from: "superAdmin: Review sources, conflicts, and learner work" },
  "sources.resolve.any": { scope: "any", from: "superAdmin: Review sources, conflicts, and learner work" },
  "work.evaluate.any": { scope: "any", from: "superAdmin: Review sources, conflicts, and learner work" },
  "support_states.inspect": { scope: "global", from: "superAdmin: Inspect entitlements, security, and support states" },
  "access.pro": { scope: "global", from: "superAdmin: Pro-level free access" },

  // ---- Course Admin ----
  "courses.edit.assigned": { scope: "assigned", from: "courseAdmin: Build, edit, and version assigned courses only" },
  "courses.publish.assigned": { scope: "assigned", from: "courseAdmin: Publish, archive, and restore assigned courses", sensitive: true },
  "courses.archive.assigned": { scope: "assigned", from: "courseAdmin: Publish, archive, and restore assigned courses", sensitive: true },
  "courses.restore.assigned": { scope: "assigned", from: "courseAdmin: Publish, archive, and restore assigned courses", sensitive: true },
  "sources.flag.assigned": { scope: "assigned", from: "courseAdmin: Flag source conflicts for a reviewer" },
  "access.basic": { scope: "global", from: "courseAdmin, reviewer, support: Basic-level free access" },

  // ---- Learning Reviewer ----
  "courses.review.assigned": { scope: "assigned", from: "reviewer: Comment on and verify course versions in Review" },
  "sources.resolve.assigned": { scope: "assigned", from: "reviewer: Resolve source conflicts in assigned courses" },
  "work.evaluate.assigned": { scope: "assigned", from: "reviewer: Evaluate assignments, capstones, and integrity concerns" },

  // ---- Support Admin (and inspection shared with Super Admin) ----
  "entitlements.inspect": { scope: "global", from: "superAdmin + support: Inspect / See entitlement states" },
  "security.inspect": { scope: "global", from: "superAdmin + support: Inspect / See security states" },
  "lifecycle.inspect": { scope: "global", from: "support: See entitlement, lifecycle, security, and Guardian link state" },
  "guardian_links.inspect": { scope: "global", from: "support: See entitlement, lifecycle, security, and Guardian link state" },
  "support.recovery.send": { scope: "global", from: "support: Send recovery links, free a device slot, decide appeals", sensitive: true },
  "support.device.free": { scope: "global", from: "support: Send recovery links, free a device slot, decide appeals", sensitive: true },
  "support.appeal.decide": { scope: "global", from: "support: Send recovery links, free a device slot, decide appeals", sensitive: true },

  // ---- Everyone signed in, guardians, learners ----
  "self.view": { scope: "global", from: "Every signed-in Account can see itself" },
  "learn": { scope: "global", from: "ROLE_PERMS: learn (every role except guardian)" },
  "guardian.controls": { scope: "global", from: "ROLE_PERMS: guardianControls" },

  // ---- Nobody: support "Never sees payment details, private notes, or Mentor conversations" ----
  "billing.payment_details.view": { scope: "global", from: "support: Never sees payment details (no role holds this)" },
  "learners.private_notes.view": { scope: "global", from: "support: Never sees private notes (no role holds this)" },
  "learners.mentor.view": { scope: "global", from: "support: Never sees Mentor conversations (no role holds this)" },
} as const satisfies Record<string, CapDef>;

export type Cap = keyof typeof CAPABILITIES;
export const ALL_CAPS = Object.keys(CAPABILITIES) as Cap[];

export const OWNER_ONLY_CAPS = [
  "admins.view",
  "admins.invite",
  "admins.role.change",
  "admins.revoke",
  "ownership.transfer",
  "owner_academy.open",
  "owner_academy.edit",
  "pricing.change",
] as const satisfies readonly Cap[];

/** Held by no role. Listed so tests can prove it. */
export const NOBODY_CAPS = [
  "billing.payment_details.view",
  "learners.private_notes.view",
  "learners.mentor.view",
] as const satisfies readonly Cap[];

const SUPER_ADMIN: Cap[] = [
  "self.view", "learn", "platform.operate",
  "courses.edit.any", "courses.publish.any", "courses.archive.any", "courses.restore.any",
  "sources.review.any", "sources.resolve.any", "work.evaluate.any",
  "entitlements.inspect", "security.inspect", "support_states.inspect",
  "access.pro",
];

/** ROLE_CAPS as named capabilities. */
export const ROLE_CAPS: Record<RoleKey, readonly Cap[]> = {
  owner: ALL_CAPS.filter((c) => !(NOBODY_CAPS as readonly Cap[]).includes(c) && c !== "guardian.controls" && c !== "access.basic"),
  superAdmin: SUPER_ADMIN,
  courseAdmin: [
    "self.view", "learn",
    "courses.edit.assigned", "courses.publish.assigned", "courses.archive.assigned", "courses.restore.assigned",
    "sources.flag.assigned", "access.basic",
  ],
  reviewer: [
    "self.view", "learn",
    "courses.review.assigned", "sources.resolve.assigned", "work.evaluate.assigned", "access.basic",
  ],
  support: [
    "self.view", "learn",
    "entitlements.inspect", "lifecycle.inspect", "security.inspect", "guardian_links.inspect",
    "support.recovery.send", "support.device.free", "support.appeal.decide", "access.basic",
  ],
  guardian: ["self.view", "guardian.controls"],
  learner: ["self.view", "learn"],
};

/** What a request is about. Course actions name the academy (course) they touch. */
export type Target = { course: string };

/** Who is asking, as far as capabilities are concerned. */
export type Principal = { role: RoleKey; assignedCourses: readonly string[] };

export type Decision = { allowed: true; cap: Cap } | { allowed: false; reason: string };

/** The actions routes ask for. A course action is satisfied by its `.any` or `.assigned` form. */
export type Action = Cap | "courses.edit" | "courses.publish" | "courses.archive" | "courses.restore"
  | "courses.review" | "sources.flag" | "sources.review" | "sources.resolve" | "work.evaluate";

function candidates(action: Action): Cap[] {
  if (action in CAPABILITIES) return [action as Cap];
  return ([`${action}.any`, `${action}.assigned`] as string[]).filter((c): c is Cap => c in CAPABILITIES);
}

/**
 * The decision for one principal, one action, and (for course actions) one course.
 * Reasons are plain sentences for the 403 body.
 */
export function decide(principal: Principal, action: Action, target?: Target): Decision {
  const held = new Set<Cap>(ROLE_CAPS[principal.role] ?? []);
  const label = ROLE_LABEL[principal.role] ?? "This account";

  // Owner-only capabilities: only the owner role, regardless of anything stored elsewhere.
  if ((OWNER_ONLY_CAPS as readonly string[]).includes(action)) {
    return principal.role === "owner" && held.has(action as Cap)
      ? { allowed: true, cap: action as Cap }
      : { allowed: false, reason: `Only the Owner can do this. ${label} can't.` };
  }

  const caps = candidates(action).filter((c) => held.has(c));
  if (!caps.length) return { allowed: false, reason: `${label} doesn't have permission to do this.` };

  const scoped = caps.filter((c) => CAPABILITIES[c].scope !== "global");
  if (!scoped.length) return { allowed: true, cap: caps[0] };

  if (!target) return { allowed: false, reason: "This action needs a course." };
  if (target.course === OWNER_ACADEMY_SLUG) {
    return { allowed: false, reason: "The Owner Academy is protected. Only the Owner can open or change it." };
  }
  const any = scoped.find((c) => CAPABILITIES[c].scope === "any");
  if (any) return { allowed: true, cap: any };
  const assigned = scoped.find((c) => CAPABILITIES[c].scope === "assigned");
  // The Owner isn't assigned courses: every course is theirs (the Owner Academy is handled above).
  if (assigned && (principal.role === "owner" || principal.assignedCourses.includes(target.course))) {
    return { allowed: true, cap: assigned };
  }
  return { allowed: false, reason: `This course isn't assigned to this ${label}.` };
}

export function isSensitive(action: Action): boolean {
  return candidates(action).some((c) => "sensitive" in CAPABILITIES[c]);
}
