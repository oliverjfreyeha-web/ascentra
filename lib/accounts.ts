import "server-only";
import type { UserJSON } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";

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
  };
}

export type SyncOutcome =
  | "owner_seeded"
  | "updated"
  | "stale_ignored"
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

/** Applies a verified user.created / user.updated event. */
export async function syncClerkUser(user: UserJSON, ownerEmail: string): Promise<SyncOutcome> {
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

  if (plan.action === "update" && existing) {
    const { error } = await db.from("accounts").update(accountFields(identity)).eq("id", existing.id);
    if (error) throw new Error(`account update failed: ${error.message}`);
    await upsertProfile(existing.id, identity);
    if (plan.passwordChanged) {
      await recordAuditEvent({
        type: "account.password_changed",
        accountId: existing.id,
        role: existing.role,
        detail: "Password set or reset. Recovery through Clerk's verified-email flow also records this.",
        at: identity.passwordLastUpdatedAt!,
      });
    }
  }
  return plan.outcome;
}

/** Applies a verified user.deleted event. The row is kept (disabled) for the audit trail. */
export async function disableClerkUser(clerkUserId: string): Promise<void> {
  const existing = await findAccountByClerkId(clerkUserId);
  if (!existing) return;
  const { error } = await getDb()
    .from("accounts")
    .update({ status: "disabled", updated_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (error) throw new Error(`account disable failed: ${error.message}`);
  await recordAuditEvent({
    type: "account.disabled",
    accountId: existing.id,
    role: existing.role,
    detail: "Clerk user deleted",
    at: new Date().toISOString(),
  });
}
