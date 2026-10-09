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
/**
 * sensitive: re-check the second factor (Clerk reverification).
 * reason: the request must carry a reason (5+ characters); it's recorded with the audit event.
 */
type CapDef = { scope: Scope; from: string; sensitive?: true; reason?: true };

export const CAPABILITIES = {
  // ---- NEVER_CAPS: the Owner only, whatever the database says ----
  "admins.view": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)" },
  "admins.invite": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)", sensitive: true, reason: true },
  "admins.role.change": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)", sensitive: true, reason: true },
  "admins.revoke": { scope: "global", from: "NEVER_CAPS: Grant, change, or revoke administrator roles (Owner only)", sensitive: true, reason: true },
  "ownership.transfer": { scope: "global", from: "NEVER_CAPS: Change or transfer ownership (Owner only)", sensitive: true, reason: true },
  "owner_academy.open": { scope: "global", from: "NEVER_CAPS: Open or change the protected Owner Academy (Owner only)" },
  "owner_academy.edit": { scope: "global", from: "NEVER_CAPS: Open or change the protected Owner Academy (Owner only)", sensitive: true, reason: true },
  "pricing.change": { scope: "global", from: "NEVER_CAPS: Change plan prices (locked: Basic $20, Pro $50)", sensitive: true, reason: true },
  // B4: refunds and credits are the Owner's alone, with a reason.
  "billing.adjustments.view": { scope: "global", from: "B4: Refunds and credits are Owner-only (look up an account's charges)" },
  "billing.refund": { scope: "global", from: "B4: Refunds and credits are Owner-only, with a reason, and audited", sensitive: true, reason: true },
  "billing.credit": { scope: "global", from: "B4: Refunds and credits are Owner-only, with a reason, and audited", sensitive: true, reason: true },
  // L1: the open-license list is the Owner's.
  "sources.open_list.edit": { scope: "global", from: "L1: an open-license list the Owner can edit", reason: true },

  // ---- Super Admin ----
  "platform.operate": { scope: "global", from: "superAdmin: Operate platform areas (not administrator management)" },
  "courses.edit.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy" },
  "courses.publish.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy", sensitive: true, reason: true },
  "courses.archive.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy", sensitive: true, reason: true },
  "courses.restore.any": { scope: "any", from: "superAdmin: Build, edit, publish, archive, and restore any course except the protected Owner Academy", sensitive: true, reason: true },
  "sources.review.any": { scope: "any", from: "superAdmin: Review sources, conflicts, and learner work" },
  "sources.resolve.any": { scope: "any", from: "superAdmin: Review sources, conflicts, and learner work" },
  "work.evaluate.any": { scope: "any", from: "superAdmin: Review sources, conflicts, and learner work" },
  "support_states.inspect": { scope: "global", from: "superAdmin: Inspect entitlements, security, and support states" },
  "access.pro": { scope: "global", from: "superAdmin: Pro-level free access" },

  // ---- Course Admin ----
  "courses.edit.assigned": { scope: "assigned", from: "courseAdmin: Build, edit, and version assigned courses only" },
  "courses.publish.assigned": { scope: "assigned", from: "courseAdmin: Publish, archive, and restore assigned courses", sensitive: true, reason: true },
  "courses.archive.assigned": { scope: "assigned", from: "courseAdmin: Publish, archive, and restore assigned courses", sensitive: true, reason: true },
  "courses.restore.assigned": { scope: "assigned", from: "courseAdmin: Publish, archive, and restore assigned courses", sensitive: true, reason: true },
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
  "support.recovery.send": { scope: "global", from: "support: Send recovery links, free a device slot, decide appeals", sensitive: true, reason: true },
  "support.device.free": { scope: "global", from: "support: Send recovery links, free a device slot, decide appeals", sensitive: true, reason: true },
  "support.appeal.decide": { scope: "global", from: "support: decide appeals; decideAppeal needs inspectAccounts (owner, superAdmin, support)", sensitive: true, reason: true },
  "support.dob.change": { scope: "global", from: "B2: the date of birth can't be changed by the user after it's set; a change needs Support, with a reason", sensitive: true, reason: true },

  // ---- The audit log (F5): Owner and Super Admin read it; only the Owner verifies the chain ----
  "audit.view": { scope: "global", from: "F5: Owner and Super Admin get a searchable audit view" },
  "audit.export": { scope: "global", from: "F5: exporting the audit log is itself audited (privacy)", sensitive: true, reason: true },
  "audit.verify": { scope: "global", from: "F5: the Owner can run the chain verification" },

  // ---- Devices and account-sharing safeguards (F6) ----
  "security.limit": { scope: "global", from: "F6: Limit needs Support (ENF: Temporary restriction)", sensitive: true, reason: true },
  "security.suspend": { scope: "global", from: "F6: Suspend needs a Super Admin or the Owner after human review", sensitive: true, reason: true },

  // ---- Everyone signed in, guardians, learners ----
  "self.view": { scope: "global", from: "Every signed-in Account can see itself" },
  "devices.manage": { scope: "global", from: "securityView: your trusted devices, sign one out or remove it" },
  "devices.replace": { scope: "global", from: "securityView: a new device past the limit replaces one, after a second-factor check", sensitive: true },
  "security.verify": { scope: "global", from: "ENF: Verification challenge (confirm it's you)", sensitive: true },
  "security.appeal.submit": { scope: "global", from: "ENF: every step explains what happened and how to appeal" },
  "learn": { scope: "global", from: "ROLE_PERMS: learn (every role except guardian)" },
  "guardian.controls": { scope: "global", from: "ROLE_PERMS: guardianControls" },
  // ---- Guardians (B3): verify, agree for a teen, pay as customer of record, withdraw ----
  "guardian.identity.verify": { scope: "global", from: "gAuthorize 1: Confirm you're an adult (an identity check in production)" },
  "guardian.consent.give": { scope: "global", from: "gAuthorize 6: Teen Terms and Minor Privacy Notice, agreed by the Guardian", sensitive: true },
  "guardian.consent.withdraw": { scope: "global", from: "GCONSENT: the Guardian can withdraw consent; the teen's account pauses", sensitive: true, reason: true },

  // ---- Billing (B1): prices are locked in code (lib/billing-terms.ts); no role can change them ----
  "billing.view": { scope: "global", from: "B1: Account → Plan and billing: your plan, trial end and next charge" },
  "billing.subscribe": { scope: "global", from: "B1: a learner chooses Basic or Pro and checks out (Stripe Checkout); B3: a Guardian, for a teen" },
  "billing.portal": { scope: "global", from: "B1: cancel, change plan or payment method in Stripe's customer portal", sensitive: true },
  // Not sensitive on purpose: cancelling takes no more steps than signing up (B4).
  "billing.cancel": { scope: "global", from: "B4: Cancellation stays online, in as few steps as sign-up" },

  // ---- Privacy Center (B4) ----
  "privacy.view": { scope: "global", from: "B4: Privacy Center: the documents and versions I agreed to, and my requests" },
  "privacy.export": { scope: "global", from: "B4: download my data (JSON)", sensitive: true },
  "privacy.delete.request": { scope: "global", from: "B4: request deletion (tracked with a due date)", sensitive: true },
  "privacy.consent.withdraw": { scope: "global", from: "B4: withdraw optional consent (recurring billing)" },

  // ---- Source library (L1): Owner and Reviewer add and approve; Reviewers record authority decisions ----
  "sources.library.view": { scope: "global", from: "L1: the Source library admin page (list, filter, conflicts)" },
  "sources.search": { scope: "global", from: "L1: retrieval of approved, cited passages for a topic" },
  "sources.library.add": { scope: "global", from: "L1: Owner and Reviewer can add sources" },
  "sources.library.decide": { scope: "global", from: "L1: Owner and Reviewer approve or reject sources", reason: true },
  "sources.claims.manage": { scope: "global", from: "L1: extract claims, add a claim, open a conflict" },
  "sources.conflicts.decide": { scope: "global", from: "reviewer: Resolve source conflicts (AuthorityDecision: which source is followed, and why)", reason: true },
  "ai.status": { scope: "global", from: "L1: AI orchestration status, spend and the provider health check" },

  // ---- Course generation (L2): AI drafts, people approve. Each route also applies the course scope of
  // courses.edit / courses.review / courses.publish (assigned courses for Course Admins and Reviewers). ----
  "sources.research": { scope: "global", from: "L2: research a topic with live web search; what it finds is proposed, not usable until approved" },
  "courses.view": { scope: "global", from: "L2: the course builder: blueprints, lesson versions, reviews (assigned courses for Course Admins and Reviewers)" },
  "courses.build": { scope: "global", from: "courseAdmin: Build, edit, and version assigned courses only (L2: blueprints and lesson drafts)" },
  "courses.verify": { scope: "global", from: "reviewer: Comment on and verify course versions in Review" },
  "courses.release": { scope: "global", from: "courseAdmin: Publish, archive, and restore assigned courses (L2: publish a verified lesson version)", sensitive: true, reason: true },
  // ---- Freshness cycle (L3): the Owner sets the interval; builders and Reviewers queue a refresh (course scope applies) ----
  "courses.refresh.configure": { scope: "global", from: "L3: a refresh setting per course (30 to 60 days); the Owner can change it", reason: true },
  "courses.refresh.run": { scope: "global", from: "L3: queue a course's refresh for the next run, after seeing its cost estimate" },
  // ---- Topic catalog (L6): the Owner, Course Admins and Reviewers see it; the Owner and Course Admins queue topics ----
  "catalog.view": { scope: "global", from: "L6: a topic catalog admin page (Owner, Course Admin, Reviewer)" },
  "catalog.queue": { scope: "global", from: "L6: batch generation: the Owner or Course Admin selects topics and the server queues them" },
  // ---- Course requests (L7): anonymous requests for topics with no published course, in a Course Admin queue ----
  "course_requests.view": { scope: "global", from: "L7: record an anonymous request (topic and level only) in a Course Admin queue" },
  "course_requests.manage": { scope: "global", from: "L7: the Course Admin queue: mark a request planned or dismissed", reason: true },
  // ---- Pick your path (L8): the Owner and authorized staff manage the topics; only the Owner changes a learner's business ----
  "topics.view": { scope: "global", from: "L8: /admin/topics for the Owner and authorized staff, with anonymous demand counts" },
  "topics.manage": { scope: "global", from: "L8: add, edit, publish/unpublish, set teen_hidden and has_course, reorder (every change audited)" },
  "picks.inspect": { scope: "global", from: "L8: the Owner looks up a learner's picks to change their business" },
  "picks.override": { scope: "global", from: "L8: a locked business: only the Owner can change it, audited with a reason", sensitive: true, reason: true },
  // ---- Course structure and Owner review (C1): the Owner approves every module before a course publishes ----
  "courses.owner_review": { scope: "global", from: "C1: the Owner's approval is the required last step: approve a module or send it back with a note", sensitive: true },
  "courses.publish_course": { scope: "global", from: "C1: the Owner publishes or unpublishes a whole course (unpublishing keeps learners' progress)", sensitive: true, reason: true },
  "courses.videos": { scope: "global", from: "C1: video slots: the Owner uploads, replaces and approves the videos they make" },
  "courses.boosters": { scope: "global", from: "C1: the Owner edits the list of learning boosters" },
  // ---- Mentor safety (L4): the review queue holds no conversation text ----
  "safety.view": { scope: "global", from: "L4: a review queue for the Owner and Super Admin (categories and actions, never conversation text)" },
  "safety.review": { scope: "global", from: "L4: safety checks with SafetyEvent records and a review queue for the Owner and Super Admin", reason: true },

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
  "billing.adjustments.view",
  "billing.refund",
  "billing.credit",
  "sources.open_list.edit",
  "courses.refresh.configure",
  "picks.inspect",
  "picks.override",
  "courses.owner_review",
  "courses.publish_course",
  "courses.videos",
  "courses.boosters",
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
  "audit.view", "audit.export",
  // decideAppeal checks inspectAccounts, which the prototype gives the Super Admin too.
  "support.appeal.decide", "security.suspend",
  "sources.library.view", "sources.search", "ai.status",
  "sources.research", "courses.view", "courses.build", "courses.release", "courses.refresh.run",
  "safety.view", "safety.review", "topics.view", "topics.manage",
];

/** Every signed-in Account manages its own devices and can answer a safeguard step. */
const SELF_SECURITY: Cap[] = [
  "devices.manage", "devices.replace", "security.verify", "security.appeal.submit", "billing.view",
  "privacy.view", "privacy.export", "privacy.delete.request",
];

const OWNER_EXCLUDED: Cap[] = [
  "guardian.controls", "guardian.identity.verify", "guardian.consent.give", "guardian.consent.withdraw",
  "access.basic", "billing.subscribe", "billing.portal", "billing.cancel", "privacy.consent.withdraw",
  // The Owner account can't be deleted.
  "privacy.delete.request",
];

/** ROLE_CAPS as named capabilities. */
export const ROLE_CAPS: Record<RoleKey, readonly Cap[]> = {
    // The Owner has full access, so there is nothing to subscribe to.
  owner: ALL_CAPS.filter((c) => !(NOBODY_CAPS as readonly Cap[]).includes(c) && !OWNER_EXCLUDED.includes(c)),
  superAdmin: [...SUPER_ADMIN, ...SELF_SECURITY],
  courseAdmin: [
    "self.view", "learn",
    "courses.edit.assigned", "courses.publish.assigned", "courses.archive.assigned", "courses.restore.assigned",
    "sources.flag.assigned", "access.basic", "sources.library.view", "sources.search",
    "sources.research", "courses.view", "courses.build", "courses.release", "courses.refresh.run", "catalog.view", "catalog.queue",
    "course_requests.view", "course_requests.manage", "topics.view", "topics.manage", ...SELF_SECURITY,
  ],
  reviewer: [
    "self.view", "learn",
    "courses.review.assigned", "sources.resolve.assigned", "work.evaluate.assigned", "access.basic",
    "sources.library.view", "sources.search", "sources.library.add", "sources.library.decide", "sources.claims.manage", "sources.conflicts.decide",
    "sources.research", "courses.view", "courses.verify", "courses.refresh.run", "catalog.view",
    ...SELF_SECURITY,
  ],
  support: [
    "self.view", "learn",
    "entitlements.inspect", "lifecycle.inspect", "security.inspect", "guardian_links.inspect",
    "support.recovery.send", "support.device.free", "support.appeal.decide", "security.limit", "support.dob.change",
    "access.basic", ...SELF_SECURITY,
  ],
  // A Guardian is the customer of record for their teens (B3): they subscribe and manage billing.
  guardian: [
    "self.view", "guardian.controls", "guardian.identity.verify", "guardian.consent.give", "guardian.consent.withdraw",
    "billing.subscribe", "billing.portal", "billing.cancel", "privacy.consent.withdraw", ...SELF_SECURITY,
  ],
  learner: ["self.view", "learn", "billing.subscribe", "billing.portal", "billing.cancel", "privacy.consent.withdraw", ...SELF_SECURITY],
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

/** Actions that must carry a reason, which is recorded with the audit event. */
export function requiresReason(action: Action): boolean {
  return candidates(action).some((c) => "reason" in CAPABILITIES[c]);
}
