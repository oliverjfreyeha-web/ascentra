/**
 * Rules for admin roles and invites, with no database or network: the webhook and the API both
 * call these, and the tests exercise them directly.
 */
import { z } from "zod";
import { ADMIN_ROLES, OWNER_ACADEMY_SLUG, ROLE_LABEL, isAdminRole, type AdminRole } from "@/lib/caps";

export const INVITE_TTL_DAYS = 7;

/** role_assignments.role stores snake_case; the code uses the prototype's camelCase. */
const TO_DB: Record<AdminRole, string> = {
  superAdmin: "super_admin",
  courseAdmin: "course_admin",
  reviewer: "reviewer",
  support: "support",
};
export const toDbRole = (role: AdminRole) => TO_DB[role];
/** Anything that isn't exactly one of the four becomes null: a forged or unknown value grants nothing. */
export function fromDbRole(value: unknown): AdminRole | null {
  const found = (Object.entries(TO_DB) as [AdminRole, string][]).find(([, db]) => db === value);
  return found ? found[0] : null;
}

/** Course (academy) scope each role takes: Super Admin covers every course, Support none. */
export const ROLE_SCOPE: Record<AdminRole, "all" | "assigned" | "none"> = {
  superAdmin: "all",
  courseAdmin: "assigned",
  reviewer: "assigned",
  support: "none",
};

const ALLOWED = ADMIN_ROLES.map((r) => ROLE_LABEL[r]).join(", ");
const roleSchema = z.string().superRefine((v, ctx) => {
  if (!isAdminRole(v)) {
    ctx.addIssue({
      code: "custom",
      message: `"${v}" isn't an administrator role. Choose one of: ${ALLOWED}.`,
    });
  }
});
const coursesSchema = z.array(z.string().regex(/^[a-z0-9-]{1,40}$/, "Course ids are short lowercase slugs.")).max(50);

export type RoleGrant = { role: AdminRole; courses: string[] };
export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

function checkGrant(role: string, courses: string[]): Checked<RoleGrant> {
  const r = role as AdminRole;
  const unique = [...new Set(courses)];
  if (unique.includes(OWNER_ACADEMY_SLUG)) {
    return { ok: false, reason: "The Owner Academy can't be assigned. Only the Owner can open or change it." };
  }
  const scope = ROLE_SCOPE[r];
  if (scope === "assigned" && unique.length === 0) {
    return { ok: false, reason: `A ${ROLE_LABEL[r]} needs at least one assigned course.` };
  }
  if (scope !== "assigned" && unique.length > 0) {
    return {
      ok: false,
      reason: scope === "all"
        ? "A Super Admin already covers every course except the Owner Academy; don't list courses."
        : "A Support Admin isn't assigned to courses.",
    };
  }
  return { ok: true, value: { role: r, courses: unique } };
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "The request isn't valid.";
}

export function parseInviteRequest(body: unknown): Checked<RoleGrant & { email: string }> {
  const parsed = z
    .object({ email: z.email("Enter a valid email address."), role: roleSchema, courses: coursesSchema.default([]) })
    .strict()
    .safeParse(body);
  if (!parsed.success) return { ok: false, reason: firstIssue(parsed.error) };
  const grant = checkGrant(parsed.data.role, parsed.data.courses);
  if (!grant.ok) return grant;
  return { ok: true, value: { ...grant.value, email: parsed.data.email.trim().toLowerCase() } };
}

export function parseRoleChange(body: unknown): Checked<RoleGrant> {
  const parsed = z.object({ role: roleSchema, courses: coursesSchema.default([]) }).strict().safeParse(body);
  if (!parsed.success) return { ok: false, reason: firstIssue(parsed.error) };
  return checkGrant(parsed.data.role, parsed.data.courses);
}

export type InviteRow = {
  id: string;
  status: "invited" | "claimed" | "active" | "revoked";
  invited_email: string | null;
  expires_at: string | null;
  account_id: string | null;
  claimed_by_clerk_user_id: string | null;
};

export type Claimant = { clerkUserId: string; email: string | null; emailVerified: boolean };

/**
 * May this newly signed-up Clerk user claim this invite? Single-use, unexpired, and only for the
 * email it was sent to (verified).
 */
export function checkInviteClaim(invite: InviteRow | null, who: Claimant, now: Date): Checked<null> {
  if (!invite) return { ok: false, reason: "No such invite." };
  if (invite.status === "revoked") return { ok: false, reason: "This invite was revoked." };
  if (invite.status !== "invited" || invite.claimed_by_clerk_user_id) {
    return { ok: false, reason: "This invite has already been used." };
  }
  if (!invite.expires_at || Date.parse(invite.expires_at) <= now.getTime()) {
    return { ok: false, reason: "This invite has expired." };
  }
  if (!who.email || !who.emailVerified) return { ok: false, reason: "The email address isn't verified." };
  if (who.email.toLowerCase() !== invite.invited_email) {
    return { ok: false, reason: "This invite was sent to a different email address." };
  }
  return { ok: true, value: null };
}

/** A claimed invite becomes an active role only with a second factor, and only before it expires. */
export function checkInviteActivation(invite: InviteRow, twoFactorEnabled: boolean, now: Date): Checked<null> {
  if (invite.status !== "claimed") return { ok: false, reason: "Only a claimed invite can be activated." };
  if (!invite.expires_at || Date.parse(invite.expires_at) <= now.getTime()) {
    return { ok: false, reason: "This invite expired before a second factor was added." };
  }
  if (!twoFactorEnabled) return { ok: false, reason: "A second factor is required to accept an admin role." };
  return { ok: true, value: null };
}
