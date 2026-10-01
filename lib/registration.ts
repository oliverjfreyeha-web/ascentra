import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { SYSTEM_ACTOR, recordAudit, type AuditActor } from "@/lib/audit";
import {
  accountFields, findAccountByClerkId, findLiveAssignment, findProfile, identityFromClerkUser, upsertProfile,
  type AccountRow, type ClerkIdentity,
} from "@/lib/accounts";
import { accountRefusal } from "@/lib/auth";
import { ageGroup, ageOn, isoDate, parseDob, usToday } from "@/lib/age";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * B2: the sign-up step. After Clerk sign-up, a Clerk user has no ASCENTRA account until they give their date
 * of birth and confirm they live in the US. The server computes the age:
 *   under 14 → refused; nothing is stored and the Clerk user is deleted;
 *   14 to 17 → a pending teen learner (is_minor), who can only invite a Guardian until the Guardian authorizes;
 *   18 or older → an active adult learner, who can go to checkout.
 * The Owner and invited admins never come through here: their accounts are made by the Clerk webhook.
 */

/** What the person sees after a refusal for age. No hint to try again. */
export const NOT_ELIGIBLE = "We can't create an account. ASCENTRA isn't available for this account. Nothing you entered was saved.";
export const US_ONLY = "ASCENTRA is available in the United States only. Confirm that you live in the US to continue.";
export const DOB_INVALID = "Enter a real date, like March 4 2001.";
export const DOB_ALREADY_SET = "Your date of birth is already set. Only Support can change it.";

export type RegistrationState =
  | { state: "dob" }
  | { state: "guardian"; guardianEmail: string | null }
  | { state: "second_factor" }
  | { state: "ready" }
  | { state: "not_open"; reason: string };

export type Result =
  | { ok: true; status: number; body: RegistrationState }
  | { ok: false; status: number; error: string; reason: string };

const fail = (status: number, reason: string, error = status === 409 ? "conflict" : status === 403 ? "forbidden" : "invalid_request"): Result =>
  ({ ok: false, status, error, reason });

async function clerkIdentity(clerkUserId: string): Promise<ClerkIdentity> {
  const user = await (await clerkClient()).users.getUser(clerkUserId);
  if (!user.raw) throw new Error("Clerk returned a user without its data");
  return identityFromClerkUser(user.raw);
}

/**
 * Why this Clerk user can't take the sign-up step, or null. The Owner and admins are never learners: they are
 * never asked for a date of birth, so nothing here can make them a minor or pending.
 */
async function signupBlock(identity: ClerkIdentity, ownerEmail: string): Promise<string | null> {
  if (!identity.email || !identity.emailVerified) return "Verify your email address first, then sign in again.";
  if (identity.email === ownerEmail.trim().toLowerCase()) return "This is the Owner's sign-in. It doesn't use the sign-up step.";
  if (identity.inviteId) return "This sign-in comes from an administrator invitation. Your role starts once a second factor is on.";
  const { data, error } = await getDb().from("role_assignments").select("id").eq("invited_email", identity.email)
    .in("status", ["invited", "claimed", "active"]).limit(1);
  if (error) throw new Error(`invite lookup failed: ${error.message}`);
  if (data?.length) return "This email has an administrator invitation. Use the link in the invitation email.";
  return null;
}

async function openGuardianInvite(teenId: string): Promise<{ id: string; invited_email: string } | null> {
  const { data, error } = await getDb().from("guardian_relationships").select("id, invited_email")
    .eq("teen_account_id", teenId).eq("verification_status", "invited").maybeSingle();
  if (error) throw new Error(`guardian invitation lookup failed: ${error.message}`);
  return data as { id: string; invited_email: string } | null;
}

const isWaitingTeen = (row: AccountRow) => row.role === "learner" && row.is_minor && row.status === "pending";

async function stateOfAccount(row: AccountRow, ownerEmail: string): Promise<RegistrationState> {
  if (isWaitingTeen(row)) return { state: "guardian", guardianEmail: (await openGuardianInvite(row.id))?.invited_email ?? null };
  const refusal = accountRefusal(row, row.role === "admin" ? await findLiveAssignment(row.id) : null, ownerEmail);
  if (!refusal) return { state: "ready" };
  // A learner with a password, or the Owner or an admin (an invited admin's role starts once it's on).
  if (refusal === "second_factor_missing") return { state: "second_factor" };
  return { state: "not_open", reason: "This account doesn't have access." };
}

/** Where this signed-in Clerk user stands. */
export async function registrationState(clerkUserId: string, ownerEmail: string): Promise<RegistrationState> {
  const row = await findAccountByClerkId(clerkUserId);
  if (row) return stateOfAccount(row, ownerEmail);
  const block = await signupBlock(await clerkIdentity(clerkUserId), ownerEmail);
  return block ? { state: "not_open", reason: block } : { state: "dob" };
}

const learnerActor = (id: string, label: string, teen: boolean): AuditActor =>
  ({ accountId: id, label: `${label} (Learner${teen ? ", waiting for Guardian" : ""})`, role: "learner" });

/** The sign-up step. Body: { dateOfBirth: "YYYY-MM-DD", usResident: true }. */
export async function register(clerkUserId: string, body: Record<string, unknown>, ownerEmail: string, now = new Date()): Promise<Result> {
  if (await findAccountByClerkId(clerkUserId)) return fail(409, DOB_ALREADY_SET);
  const identity = await clerkIdentity(clerkUserId);
  const block = await signupBlock(identity, ownerEmail);
  if (block) return fail(403, block);
  if (body.usResident !== true) return fail(400, US_ONLY);
  const today = usToday(now);
  const dob = parseDob(body.dateOfBirth, today);
  if (!dob) return fail(400, DOB_INVALID);
  const group = ageGroup(ageOn(dob, today));

  if (group === "under_minimum") {
    // Nothing is stored: no account, no date of birth, nothing identifying in the log or the audit event.
    try {
      await (await clerkClient()).users.deleteUser(clerkUserId);
    } catch (err) {
      console.error("[registration] could not delete a refused sign-in:", err instanceof Error ? err.message : "unknown error");
    }
    await recordAudit({
      actor: SYSTEM_ACTOR("Sign-up step"), action: "registration.refused",
      context: "A sign-up was refused: ASCENTRA is for learners 14 and older. Nothing entered was kept, and the new sign-in was deleted.",
      result: "Blocked", sensitive: true,
    });
    return fail(403, NOT_ELIGIBLE, "not_eligible");
  }

  const teen = group === "teen";
  const db = getDb();
  const { data, error } = await db.from("accounts").insert({
    clerk_user_id: clerkUserId, role: "learner", status: teen ? "pending" : "active", is_minor: teen,
    date_of_birth: isoDate(dob), us_resident_confirmed_at: now.toISOString(), ...accountFields(identity),
  }).select("id").single();
  // 23505: another request for this Clerk user got there first. 23514: the database's own age check refused it.
  if (error?.code === "23505") return fail(409, DOB_ALREADY_SET);
  if (error?.code === "23514") return fail(400, DOB_INVALID);
  if (error) throw new Error(`learner insert failed: ${error.message}`);
  const id = data.id as string;
  await upsertProfile(id, identity);
  await recordAudit({
    actor: learnerActor(id, identity.displayName, teen),
    action: teen ? "registration.teen" : "registration.adult",
    context: teen
      ? "Signed up as a teen learner (14 to 17, US). The account waits for a verified Guardian; until then it can't learn, pay or message."
      : "Signed up as an adult learner (18 or older, US). The date of birth is on file and can only be changed by Support.",
    target: { type: "account", id, label: identity.email }, previous: "none",
    next: teen ? "teen learner, waiting for Guardian" : "adult learner, active", result: "Completed",
  });
  return { ok: true, status: 201, body: teen ? { state: "guardian", guardianEmail: null } : await stateOfAccount((await findAccountByClerkId(clerkUserId))!, ownerEmail) };
}

const guardianLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 });
const emailSchema = z.email();

/**
 * A waiting teen names their Guardian. Stored as an invitation (guardian_relationships, 'invited'); B3 sends it.
 * Until then the teen can change the email; each change is audited.
 */
export async function inviteGuardian(clerkUserId: string, body: Record<string, unknown>, now = new Date()): Promise<Result> {
  const row = await findAccountByClerkId(clerkUserId);
  if (!row || !isWaitingTeen(row)) return fail(403, "Only a teen account waiting for its Guardian can do this.");
  const email = typeof body.guardianEmail === "string" ? body.guardianEmail.trim().toLowerCase() : "";
  if (!emailSchema.safeParse(email).success) return fail(400, "Enter your parent or guardian's email, like name@example.com.");
  if (email === row.email.toLowerCase()) return fail(400, "Enter your parent or guardian's email, not your own.");
  if (!guardianLimiter.check(row.id, now.getTime()).ok) return fail(429, "Too many changes. Try again in an hour.", "rate_limited");

  const db = getDb();
  const open = await openGuardianInvite(row.id);
  if (open?.invited_email === email) return { ok: true, status: 200, body: { state: "guardian", guardianEmail: email } };
  const { error } = open
    ? await db.from("guardian_relationships").update({ invited_email: email, invited_at: now.toISOString() }).eq("id", open.id)
    : await db.from("guardian_relationships").insert({
      teen_account_id: row.id, invited_email: email, invited_at: now.toISOString(), verification_status: "invited",
    });
  if (error?.code === "23505") return fail(409, "Your Guardian invitation changed at the same time. Reload the page.");
  if (error) throw new Error(`guardian invitation failed: ${error.message}`);
  const profile = await findProfile(row.id);
  await recordAudit({
    actor: learnerActor(row.id, profile?.display_name ?? row.email, true), action: "guardian.invite",
    context: "A teen named their Guardian. The invitation is stored and is sent once Guardian sign-up opens (B3); nothing was sent yet.",
    target: { type: "account", id: row.id, label: row.email }, previous: open?.invited_email ?? "none", next: email, result: "Completed",
  });
  return { ok: true, status: open ? 200 : 201, body: { state: "guardian", guardianEmail: email } };
}
