import "server-only";
import type { UserJSON } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { SYSTEM_ACTOR, recordAudit } from "@/lib/audit";

const WEBHOOK = SYSTEM_ACTOR("Clerk webhook");
import { checkInviteActivation, checkInviteClaim, type InviteRow } from "@/lib/admin-rules";

export type Role = "owner" | "admin" | "learner" | "guardian";

export type AccountRow = {
  id: string;
  clerk_user_id: string;
  email: string;
  email_verified: boolean;
  role: Role;
  is_minor: boolean;
  status: "active" | "disabled";
  password_enabled: boolean;
  two_factor_enabled: boolean;
  password_last_updated_at: string | null;
  clerk_updated_at: string;
};

export type ProfileRow = { account_id: string; display_name: string; image_url: string | null };

/** A role_assignments row: an open invite, or the role an admin holds. */
export type AssignmentRow = InviteRow & {
  role: string;
  scope: string[];
  clerk_invitation_id: string | null;
  assigned_by_account_id: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

/** The fields ASCENTRA keeps from a Clerk user. */
export type ClerkIdentity = {
  clerkUserId: string;
  email: string | null;
  emailVerified: boolean;
  passwordEnabled: boolean;
  twoFactorEnabled: boolean;
  passwordLastUpdatedAt: string | null;
  clerkUpdatedAt: string;
  displayName: string;
  imageUrl: string | null;
  /** Set on the Clerk invitation by the Owner's admin invite; copied to the user at sign-up. */
  inviteId: string | null;
};

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

export function identityFromClerkUser(user: UserJSON): ClerkIdentity {
  const primary = user.email_addresses.find((e) => e.id === user.primary_email_address_id) ?? null;
  const email = primary?.email_address.toLowerCase() ?? null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return {
    clerkUserId: user.id,
    email,
    emailVerified: primary?.verification?.status === "verified",
    passwordEnabled: user.password_enabled,
    twoFactorEnabled: user.two_factor_enabled,
    passwordLastUpdatedAt: iso(user.password_last_updated_at),
    clerkUpdatedAt: iso(user.updated_at)!,
    displayName: name || email?.split("@")[0] || "Account",
    imageUrl: user.has_image ? user.image_url : null,
    inviteId: typeof user.public_metadata?.ascentra_invite_id === "string" ? user.public_metadata.ascentra_invite_id : null,
  };
}

export type SyncOutcome =
  | "owner_seeded"
  | "updated"
  | "stale_ignored"
  | "admin_claimed" // Signed up through a valid admin invite; the role waits for a second factor.
  | "admin_activated" // A claimed invite now has a second factor: the admin role is active.
  | "invite_refused" // Carried an invite that was expired, used, revoked or sent to another email.
  | "no_account"; // Not the Owner and not invited: Clerk knows them, ASCENTRA gives them nothing.

/**
 * What a Clerk user event should do, decided without touching the database.
 * The Owner is seeded once: only while no Owner exists, only for a verified OWNER_EMAIL.
 */
export function planSync(
  identity: ClerkIdentity,
  existing: AccountRow | null,
  ctx: { ownerEmail: string; ownerExists: boolean },
): { action: "insert_owner" | "update" | "ignore"; outcome: SyncOutcome; passwordChanged: boolean } {
  if (existing) {
    if (Date.parse(identity.clerkUpdatedAt) < Date.parse(existing.clerk_updated_at)) {
      return { action: "ignore", outcome: "stale_ignored", passwordChanged: false };
    }
    const before = existing.password_last_updated_at ? Date.parse(existing.password_last_updated_at) : null;
    const after = identity.passwordLastUpdatedAt ? Date.parse(identity.passwordLastUpdatedAt) : null;
    return { action: "update", outcome: "updated", passwordChanged: after !== null && after !== before };
  }
  const isOwner =
    !ctx.ownerExists &&
    identity.emailVerified &&
    identity.email !== null &&
    identity.email === ctx.ownerEmail.trim().toLowerCase();
  return isOwner
    ? { action: "insert_owner", outcome: "owner_seeded", passwordChanged: false }
    : { action: "ignore", outcome: "no_account", passwordChanged: false };
}

function accountFields(identity: ClerkIdentity) {
  return {
    email: identity.email ?? "",
    email_verified: identity.emailVerified,
    password_enabled: identity.passwordEnabled,
    two_factor_enabled: identity.twoFactorEnabled,
    password_last_updated_at: identity.passwordLastUpdatedAt,
    clerk_updated_at: identity.clerkUpdatedAt,
    updated_at: new Date().toISOString(),
  };
}

export async function findAccountByClerkId(clerkUserId: string): Promise<AccountRow | null> {
  const { data, error } = await getDb().from("accounts").select("*").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`accounts lookup failed: ${error.message}`);
  return data as AccountRow | null;
}

export async function findProfile(accountId: string): Promise<ProfileRow | null> {
  const { data, error } = await getDb().from("profiles").select("*").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`profiles lookup failed: ${error.message}`);
  return data as ProfileRow | null;
}

async function ownerExists(): Promise<boolean> {
  const { count, error } = await getDb().from("accounts").select("id", { count: "exact", head: true }).eq("role", "owner");
  if (error) throw new Error(`owner lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

async function upsertProfile(accountId: string, identity: ClerkIdentity) {
  const { error } = await getDb()
    .from("profiles")
    .upsert({ account_id: accountId, display_name: identity.displayName, image_url: identity.imageUrl, updated_at: new Date().toISOString() });
  if (error) throw new Error(`profile upsert failed: ${error.message}`);
}

export async function findLiveAssignment(accountId: string): Promise<AssignmentRow | null> {
  const { data, error } = await getDb()
    .from("role_assignments")
    .select("*")
    .eq("account_id", accountId)
    .in("status", ["claimed", "active"])
    .maybeSingle();
  if (error) throw new Error(`role assignment lookup failed: ${error.message}`);
  return data as AssignmentRow | null;
}

async function findAssignment(id: string): Promise<AssignmentRow | null> {
  const { data, error } = await getDb().from("role_assignments").select("*").eq("id", id).maybeSingle();
  // An id that isn't a uuid is simply not an invite.
  if (error?.code === "22P02") return null;
  if (error) throw new Error(`role assignment lookup failed: ${error.message}`);
  return data as AssignmentRow | null;
}

/**
 * A new Clerk user who signed up through an admin invite. The invite is claimed once, atomically
 * (status must still be 'invited'), and only by the verified email it was sent to.
 */
async function claimInvite(identity: ClerkIdentity, now: Date): Promise<SyncOutcome> {
  const invite = await findAssignment(identity.inviteId!);
  const check = checkInviteClaim(invite, identity, now);
  if (!check.ok) {
    await recordAudit({
      actor: WEBHOOK, action: "admins.invite.claim",
      context: `Refused a sign-up with an admin invite: ${check.reason}`,
      target: { type: "invite", id: identity.inviteId!, label: identity.email ?? "unknown email" },
      result: "Blocked",
    });
    return "invite_refused";
  }
  const db = getDb();
  const { data: account, error } = await db
    .from("accounts")
    .insert({ clerk_user_id: identity.clerkUserId, role: "admin", ...accountFields(identity) })
    .select("id")
    .single();
  if (error) throw new Error(`admin account insert failed: ${error.message}`);

  const claimed = await db
    .from("role_assignments")
    .update({
      status: "claimed",
      account_id: account.id,
      claimed_by_clerk_user_id: identity.clerkUserId,
      claimed_at: now.toISOString(),
    })
    .eq("id", invite!.id)
    .eq("status", "invited")
    .select("id");
  if (claimed.error) throw new Error(`invite claim failed: ${claimed.error.message}`);
  if (!claimed.data?.length) {
    // Someone else claimed it between the read and the write: undo this account.
    await db.from("accounts").delete().eq("id", account.id);
    await recordAudit({
      actor: WEBHOOK, action: "admins.invite.claim", context: "Refused a sign-up with an admin invite: this invite has already been used.",
      target: { type: "invite", id: invite!.id, label: identity.email }, result: "Blocked",
    });
    return "invite_refused";
  }
  await upsertProfile(account.id as string, identity);
  await recordAudit({
    actor: WEBHOOK, action: "admins.invite.claim",
    context: `${identity.email} signed up with their admin invite. The role starts once a second factor is on.`,
    target: { type: "account", id: account.id as string, label: identity.email },
    previous: "invited", next: "claimed", result: "Completed",
  });
  return (await activateIfReady(account.id as string, identity, now)) ?? "admin_claimed";
}

/** A claimed invite whose admin now has a second factor becomes an active role. */
async function activateIfReady(accountId: string, identity: ClerkIdentity, now: Date): Promise<SyncOutcome | null> {
  const assignment = await findLiveAssignment(accountId);
  if (!assignment || assignment.status !== "claimed") return null;
  if (!checkInviteActivation(assignment, identity.twoFactorEnabled, now).ok) return null;
  const { error } = await getDb()
    .from("role_assignments")
    .update({ status: "active", accepted_at: now.toISOString() })
    .eq("id", assignment.id)
    .eq("status", "claimed");
  if (error) throw new Error(`role activation failed: ${error.message}`);
  await recordAudit({
    actor: WEBHOOK, action: "admins.activate",
    context: `The ${assignment.role} role is active: ${identity.email} has a second factor.`,
    target: { type: "account", id: accountId, label: identity.email },
    previous: "claimed", next: "active", result: "Completed",
  });
  return "admin_activated";
}

/** Applies a verified user.created / user.updated event. */
export async function syncClerkUser(user: UserJSON, ownerEmail: string, now = new Date()): Promise<SyncOutcome> {
  const identity = identityFromClerkUser(user);
  const existing = await findAccountByClerkId(identity.clerkUserId);
  const plan = planSync(identity, existing, { ownerEmail, ownerExists: existing ? true : await ownerExists() });
  const db = getDb();

  if (plan.action === "insert_owner") {
    const { data, error } = await db
      .from("accounts")
      .insert({ clerk_user_id: identity.clerkUserId, role: "owner", ...accountFields(identity) })
      .select("id")
      .single();
    // 23505: another delivery seeded the Owner first. There is still exactly one.
    if (error?.code === "23505") return "no_account";
    if (error) throw new Error(`owner insert failed: ${error.message}`);
    await upsertProfile(data.id as string, identity);
    return plan.outcome;
  }

  if (plan.outcome === "no_account" && identity.inviteId) return claimInvite(identity, now);

  if (plan.action === "update" && existing) {
    const { error } = await db.from("accounts").update(accountFields(identity)).eq("id", existing.id);
    if (error) throw new Error(`account update failed: ${error.message}`);
    await upsertProfile(existing.id, identity);
    if (plan.passwordChanged) {
      // Owner and admin passwords only: recovery through Clerk's verified-email flow lands here.
      if (existing.role === "owner" || existing.role === "admin") {
        await recordAudit({
          actor: WEBHOOK, action: "account.password_changed",
          context: `The ${existing.role === "owner" ? "Owner's" : "admin's"} password was set or reset (account recovery or a password change) at ${identity.passwordLastUpdatedAt}.`,
          target: { type: "account", id: existing.id, label: existing.email },
          previous: existing.password_last_updated_at ?? "no password", next: identity.passwordLastUpdatedAt,
          result: "Completed", sensitive: true,
        });
      }
    }
    if (existing.role === "admin") return (await activateIfReady(existing.id, identity, now)) ?? plan.outcome;
  }
  return plan.outcome;
}

/** Applies a verified user.deleted event. The row is kept (disabled) for the audit trail. The Owner is never disabled. */
export async function disableClerkUser(clerkUserId: string): Promise<void> {
  const existing = await findAccountByClerkId(clerkUserId);
  if (!existing) return;
  if (existing.role === "owner") {
    await recordAudit({
      actor: WEBHOOK, action: "account.disable",
      context: "Refused: Clerk reported the Owner's user as deleted. The Owner account can't be disabled.",
      target: { type: "account", id: existing.id, label: existing.email }, result: "Blocked", sensitive: true,
    });
    return;
  }
  const { error } = await getDb()
    .from("accounts")
    .update({ status: "disabled", updated_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (error) throw new Error(`account disable failed: ${error.message}`);
  if (existing.role === "admin") {
    await getDb().from("role_assignments").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("account_id", existing.id).in("status", ["claimed", "active"]);
  }
  await recordAudit({
    actor: WEBHOOK, action: "account.disable",
    context: `The Clerk user was deleted, so the ${existing.role} account is disabled.`,
    target: { type: "account", id: existing.id, label: existing.email },
    previous: "active", next: "disabled", result: "Completed",
  });
}
