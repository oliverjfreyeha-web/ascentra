import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { AuditInput } from "@/lib/audit";
import { INVITE_TTL_DAYS, fromDbRole, toDbRole, type RoleGrant } from "@/lib/admin-rules";
import { ROLE_LABEL, type AdminRole } from "@/lib/caps";
import { getDb } from "@/lib/db";
import type { Account } from "@/lib/auth";
import type { AccountRow, AssignmentRow } from "@/lib/accounts";

/** The audit event describing an operation's outcome; the route records it (exactly one per request). */
export type Outcome = Omit<AuditInput, "actor" | "requestId" | "reason">;
export type Result<T> =
  | { ok: true; value: T; event: Outcome }
  | { ok: false; status: number; reason: string; event: Outcome };

const fail = (status: number, reason: string, action: string, target: Outcome["target"] = null): { ok: false; status: number; reason: string; event: Outcome } =>
  ({ ok: false, status, reason, event: { action, context: `Refused: ${reason}`, target, result: "Blocked" } });

const label = (role: AdminRole | null) => (role ? ROLE_LABEL[role] : "none");
const grantText = (role: AdminRole, courses: string[]) => `${ROLE_LABEL[role]}${courses.length ? ` (${courses.join(", ")})` : ""}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminSummary = {
  accountId: string;
  email: string;
  displayName: string;
  role: AdminRole;
  courses: string[];
  /** 'awaiting_second_factor' until the invited admin adds one; the role does nothing until then. */
  state: "active" | "awaiting_second_factor";
};
export type InviteSummary = { id: string; email: string; role: AdminRole; courses: string[]; expiresAt: string; expired: boolean };

async function accountById(id: string): Promise<AccountRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await getDb().from("accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  return data as AccountRow | null;
}

async function liveAssignment(accountId: string): Promise<AssignmentRow | null> {
  const { data, error } = await getDb()
    .from("role_assignments").select("*").eq("account_id", accountId).in("status", ["claimed", "active"]).maybeSingle();
  if (error) throw new Error(`role assignment lookup failed: ${error.message}`);
  return data as AssignmentRow | null;
}

export async function listAdmins(now = new Date()): Promise<{ admins: AdminSummary[]; invites: InviteSummary[] }> {
  const db = getDb();
  const { data: rows, error } = await db
    .from("role_assignments").select("*").in("status", ["invited", "claimed", "active"]).order("created_at");
  if (error) throw new Error(`role assignments lookup failed: ${error.message}`);
  const assignments = (rows ?? []) as AssignmentRow[];

  const accountIds = assignments.map((a) => a.account_id).filter((id): id is string => !!id);
  const [accounts, profiles] = accountIds.length
    ? await Promise.all([
        db.from("accounts").select("id, email").in("id", accountIds),
        db.from("profiles").select("account_id, display_name").in("account_id", accountIds),
      ])
    : [{ data: [] }, { data: [] }];
  const emailOf = new Map((accounts.data ?? []).map((a: { id: string; email: string }) => [a.id, a.email]));
  const nameOf = new Map((profiles.data ?? []).map((p: { account_id: string; display_name: string }) => [p.account_id, p.display_name]));

  const admins: AdminSummary[] = [];
  const invites: InviteSummary[] = [];
  for (const a of assignments) {
    const role = fromDbRole(a.role);
    if (!role) continue;
    if (a.status === "invited") {
      invites.push({
        id: a.id, email: a.invited_email!, role, courses: a.scope, expiresAt: a.expires_at!,
        expired: Date.parse(a.expires_at!) <= now.getTime(),
      });
    } else if (a.account_id) {
      admins.push({
        accountId: a.account_id,
        email: emailOf.get(a.account_id) ?? a.invited_email ?? "",
        displayName: nameOf.get(a.account_id) ?? emailOf.get(a.account_id) ?? "",
        role, courses: a.scope,
        state: a.status === "active" ? "active" : "awaiting_second_factor",
      });
    }
  }
  return { admins, invites };
}

/** Owner-only (checked by the route). Creates the invite row, then Clerk's invitation email. */
export async function createInvite(owner: Account, grant: RoleGrant & { email: string }, now = new Date()): Promise<Result<InviteSummary>> {
  const db = getDb();
  const A = "admins.invite";
  const who = { type: "invite", id: grant.email, label: grant.email };
  const existing = await db.from("accounts").select("id").eq("email", grant.email).maybeSingle();
  if (existing.error) throw new Error(`account lookup failed: ${existing.error.message}`);
  if (existing.data) return fail(409, "An account with this email already exists. Invites are for new admins.", A, who);

  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const { data: row, error } = await db
    .from("role_assignments")
    .insert({
      invited_email: grant.email, role: toDbRole(grant.role), scope: grant.courses, status: "invited",
      assigned_by_account_id: owner.id, invited_at: now.toISOString(), expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return fail(409, "There's already an open invite for this email. Revoke it first.", A, who);
  if (error) throw new Error(`invite insert failed: ${error.message}`);

  let clerkInvitationId: string;
  try {
    const clerk = await clerkClient();
    const invitation = await clerk.invitations.createInvitation({
      emailAddress: grant.email,
      publicMetadata: { ascentra_invite_id: row.id },
      notify: true,
      expiresInDays: INVITE_TTL_DAYS,
    });
    clerkInvitationId = invitation.id;
  } catch (err) {
    await db.from("role_assignments").delete().eq("id", row.id);
    // Clerk's own error code and message (e.g. an existing user or a pending invitation for this email).
    const detail = (err as { errors?: { code?: string; longMessage?: string; message?: string }[] })?.errors?.[0];
    const why = detail ? `${detail.longMessage ?? detail.message ?? ""} (${detail.code ?? "no code"})` : err instanceof Error ? err.message : "unknown error";
    return fail(502, `Clerk couldn't create the invitation: ${why}. Nothing was saved.`, A, who);
  }
  const upd = await db.from("role_assignments").update({ clerk_invitation_id: clerkInvitationId }).eq("id", row.id);
  if (upd.error) throw new Error(`invite update failed: ${upd.error.message}`);

  return {
    ok: true,
    value: { id: row.id, email: grant.email, role: grant.role, courses: grant.courses, expiresAt, expired: false },
    event: {
      action: A, context: `Invited ${grant.email} as ${grantText(grant.role, grant.courses)}; the invite expires ${expiresAt}.`,
      target: { type: "invite", id: row.id, label: grant.email }, previous: null, next: grantText(grant.role, grant.courses),
      result: "Completed",
    },
  };
}

/** Owner-only. An invite can be revoked until it becomes an active role. */
export async function revokeInvite(_owner: Account, inviteId: string, now = new Date()): Promise<Result<null>> {
  const A = "admins.revoke";
  const who = { type: "invite", id: inviteId, label: inviteId };
  if (!UUID.test(inviteId)) return fail(404, "No such invite.", A, who);
  const db = getDb();
  const { data, error } = await db.from("role_assignments").select("*").eq("id", inviteId).maybeSingle();
  if (error) throw new Error(`invite lookup failed: ${error.message}`);
  const invite = data as AssignmentRow | null;
  if (!invite || !invite.invited_email) return fail(404, "No such invite.", A, who);
  const inv = { type: "invite", id: invite.id, label: invite.invited_email };
  if (invite.status === "revoked") return fail(409, "This invite is already revoked.", A, inv);
  if (invite.status === "active") return fail(409, "This invite was accepted. Remove the admin instead.", A, inv);

  if (invite.status === "invited" && invite.clerk_invitation_id) {
    try {
      const clerk = await clerkClient();
      await clerk.invitations.revokeInvitation(invite.clerk_invitation_id);
    } catch (err) {
      // Clerk refuses to revoke an invitation that was already accepted or revoked. Ours is revoked either way.
      console.warn("revokeInvite: Clerk revoke failed:", err instanceof Error ? err.message : err);
    }
  }
  const upd = await db.from("role_assignments")
    .update({ status: "revoked", revoked_at: now.toISOString() }).eq("id", inviteId).in("status", ["invited", "claimed"]);
  if (upd.error) throw new Error(`invite revoke failed: ${upd.error.message}`);
  return {
    ok: true, value: null,
    event: {
      action: A, context: `Revoked the invite for ${invite.invited_email}.`, target: inv,
      previous: `${label(fromDbRole(invite.role))} invite (${invite.status})`, next: "revoked", result: "Completed",
    },
  };
}

async function adminTarget(accountId: string, action: string): Promise<Result<{ assignment: AssignmentRow; email: string }>> {
  const who = { type: "account", id: accountId, label: accountId };
  const target = await accountById(accountId);
  if (!target) return fail(404, "No such admin.", action, who);
  const t = { type: "account", id: target.id, label: target.email };
  if (target.role === "owner") {
    return fail(403, `The Owner can't be ${action === "admins.role.change" ? "demoted or given another role" : "removed, suspended or deleted"}.`, action, t);
  }
  if (target.role !== "admin") return fail(404, "No such admin.", action, t);
  const assignment = await liveAssignment(target.id);
  if (!assignment) return fail(404, "This account doesn't hold an admin role.", action, t);
  return { ok: true, value: { assignment, email: target.email }, event: { action, context: "", result: "Completed" } };
}

/** Owner-only. */
export async function changeAdminRole(_owner: Account, accountId: string, grant: RoleGrant): Promise<Result<null>> {
  const A = "admins.role.change";
  const target = await adminTarget(accountId, A);
  if (!target.ok) return target;
  const { assignment, email } = target.value;
  const before = grantText(fromDbRole(assignment.role) ?? grant.role, assignment.scope);
  const { error } = await getDb().from("role_assignments")
    .update({ role: toDbRole(grant.role), scope: grant.courses }).eq("id", assignment.id);
  if (error) throw new Error(`role change failed: ${error.message}`);
  return {
    ok: true, value: null,
    event: {
      action: A, context: `Changed ${email}'s administrator role.`, target: { type: "account", id: accountId, label: email },
      previous: before, next: grantText(grant.role, grant.courses), result: "Completed",
    },
  };
}

/** Owner-only. The account stays (for the record) but holds no role and has no access. */
export async function removeAdmin(_owner: Account, accountId: string, now = new Date()): Promise<Result<null>> {
  const A = "admins.revoke";
  const target = await adminTarget(accountId, A);
  if (!target.ok) return target;
  const { assignment, email } = target.value;
  const { error } = await getDb().from("role_assignments")
    .update({ status: "revoked", revoked_at: now.toISOString() }).eq("id", assignment.id);
  if (error) throw new Error(`admin removal failed: ${error.message}`);
  return {
    ok: true, value: null,
    event: {
      action: A, context: `Removed ${email}'s administrator role.`, target: { type: "account", id: accountId, label: email },
      previous: grantText(fromDbRole(assignment.role) ?? "support", assignment.scope), next: "no admin role", result: "Completed",
    },
  };
}
