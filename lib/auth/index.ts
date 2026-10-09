import "server-only";
import { auth } from "@clerk/nextjs/server";
import {
  findAccountByClerkId,
  findLiveAssignment,
  findProfile,
  type AccountRow,
  type AssignmentRow,
  type Role,
} from "@/lib/accounts";
import { fromDbRole } from "@/lib/admin-rules";
import type { AdminRole, RoleKey } from "@/lib/caps";
import { readEnv } from "@/lib/env";
import { getDb } from "@/lib/db";

export type Account = {
  id: string;
  email: string;
  role: Role;
  displayName: string;
  /** The capability role: owner, one of ADMIN_ROLES, guardian or learner. */
  roleKey: RoleKey;
  adminRole: AdminRole | null;
  assignedCourses: string[];
  /** A teen learner (14 to 17). Billing for a teen goes through their Guardian. */
  isMinor: boolean;
};

/**
 * A signed-in request: the Account, the Clerk session id (one per signed-in browser), and whether the
 * session re-verified a second factor recently.
 */
export type AuthContext = { account: Account; sessionId: string | null; recentlyVerified: () => boolean };

/**
 * Why an account row can't be used, or null when it can.
 * - R1: a learner (adult or teen) is never refused for not having a second factor, with a password or a passkey.
 *   It is recommended to them, never required. If they have one, Clerk still asks for it at sign-in.
 * - The Owner, every admin and every Guardian (who acts for a minor, consents and pays) must have a second factor,
 *   whatever else they use. Unchanged.
 * - An admin needs an active role assignment (claimed invites don't count until then).
 * - The Owner row must also match OWNER_EMAIL, so an edited database row can't create an Owner.
 * - A teen waiting for their Guardian (pending), or whose Guardian withdrew consent (paused), can do nothing
 *   through the API.
 */
export function accountRefusal(row: AccountRow, assignment: AssignmentRow | null, ownerEmail: string | undefined): string | null {
  if (row.status === "pending") return "pending_guardian";
  if (row.status === "paused") return "paused";
  if (row.status !== "active") return "disabled";
  if (!row.email_verified) return "email_unverified";
  // The Owner, admins and Guardians (who act for a teen) always need a second factor. Learners don't (R1).
  if ((row.role === "owner" || row.role === "admin" || row.role === "guardian") && !row.two_factor_enabled) return "second_factor_missing";
  if (row.role === "owner" && (!ownerEmail || row.email.toLowerCase() !== ownerEmail.trim().toLowerCase())) {
    return "owner_mismatch";
  }
  if (row.role === "admin" && (assignment?.status !== "active" || !fromDbRole(assignment.role))) return "no_active_role";
  return null;
}

export function roleKeyOf(row: AccountRow, assignment: AssignmentRow | null): RoleKey | null {
  if (row.role === "owner" || row.role === "guardian" || row.role === "learner") return row.role;
  return fromDbRole(assignment?.role) ?? null;
}

/**
 * The server's single way to turn a request into an Account (and its capability role).
 * Returns null for a missing, expired, pending or invalid session, an unverified email, a missing
 * second factor, an admin without an active role, or a Clerk user with no Account.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  let session;
  try {
    session = await auth();
  } catch (err) {
    // A thrown auth() is a misconfiguration (e.g. the proxy not running), not a signed-out user: log it.
    console.error("getAccount: session check failed:", err instanceof Error ? err.message : err);
    return null;
  }
  // auth() verifies the session token (signature and expiry) and treats pending sessions as signed out.
  if (!session.isAuthenticated || !session.userId) return null;

  const row = await findAccountByClerkId(session.userId);
  if (!row) return null;
  const account = await accountOfRow(row);
  if (!account) return null;
  return {
    account,
    sessionId: session.sessionId ?? null,
    // Second factor verified within the last 10 minutes (Clerk's strict_mfa level).
    recentlyVerified: () => session.has({ reverification: "strict_mfa" }),
  };
}

/** The Account for a row, with the same checks as a signed-in request (null when the row can't be used now). */
async function accountOfRow(row: AccountRow): Promise<Account | null> {
  const assignment = row.role === "admin" ? await findLiveAssignment(row.id) : null;
  if (accountRefusal(row, assignment, readEnv("OWNER_EMAIL"))) return null;
  const roleKey = roleKeyOf(row, assignment);
  if (!roleKey) return null;
  const profile = await findProfile(row.id);
  const adminRole = row.role === "admin" ? fromDbRole(assignment?.role) : null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: profile?.display_name ?? row.email,
    roleKey,
    adminRole,
    assignedCourses: adminRole ? [...(assignment?.scope ?? [])] : [],
    isMinor: row.role === "learner" && row.is_minor,
  };
}

/**
 * L6: the Account of the person who queued a batch job, checked now (role, second factor, active), so the overnight
 * run acts with exactly their rights. Null when they can no longer act.
 */
export async function accountById(id: string): Promise<Account | null> {
  const { data, error } = await getDb().from("accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);
  return data ? accountOfRow(data as AccountRow) : null;
}

export async function getAccount(): Promise<Account | null> {
  return (await getAuthContext())?.account ?? null;
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export { requireCap, withCap } from "./require-cap";
